import { Prisma } from "@prisma/client";
import { classifyReacherResult, type ClassifiedReacherResult } from "./classifier";
import { env } from "./env";
import { enqueueBulkJob } from "./queue";
import { prisma } from "./prisma";
import { ReacherClient, ReacherWorkerModeUnavailableError } from "./reacher";
import type { ParsedUpload } from "./uploadParser";

const pollIntervalMs = 4000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export async function createBulkJobFromUpload(filename: string, parsed: ParsedUpload, adminId?: string) {
  const bulkJob = await prisma.$transaction(async (tx) => {
    const job = await tx.bulkJob.create({
      data: {
        filename,
        originalRows: parsed.originalRows,
        emptyRows: parsed.emptyRows,
        duplicateRows: parsed.duplicateRows,
        syntaxInvalidRows: parsed.syntaxInvalidRows,
        uniqueEmails: parsed.uniqueEmails.length,
        emails: {
          createMany: {
            data: parsed.uniqueEmails.map((email) => ({
              email: email.email,
              normalizedEmail: email.normalizedEmail
            }))
          }
        },
        rejectedRows: {
          createMany: {
            data: parsed.rejectedRows.map((row) => ({
              rowNumber: row.rowNumber,
              emailRaw: row.emailRaw,
              reason: row.reason
            }))
          }
        }
      }
    });

    await tx.auditLog.create({
      data: {
        adminId,
        action: "upload",
        meta: {
          bulkJobId: job.id,
          filename,
          originalRows: parsed.originalRows,
          uniqueEmails: parsed.uniqueEmails.length
        }
      }
    });

    return job;
  });

  await enqueueBulkJob(bulkJob.id);
  return bulkJob;
}

export async function processBulkJob(bulkJobId: string) {
  await prisma.bulkJob.update({
    where: { id: bulkJobId },
    data: {
      status: "processing",
      startedAt: new Date(),
      errorMessage: null
    }
  });

  const emails = await prisma.bulkJobEmail.findMany({
    where: { bulkJobId, status: { in: ["pending", "failed"] } },
    orderBy: { createdAt: "asc" }
  });

  if (!emails.length) {
    await completeJob(bulkJobId);
    return;
  }

  const client = new ReacherClient();

  if (env.REACHER_WORKER_MODE_ENABLED) {
    try {
      await processWithReacherBulk(bulkJobId, emails.map((email) => email.normalizedEmail), client);
      return;
    } catch (error) {
      if (!(error instanceof ReacherWorkerModeUnavailableError)) {
        await failJob(bulkJobId, error);
        throw error;
      }
    }
  }

  await processWithLocalWorker(bulkJobId, emails, client);
}

async function processWithReacherBulk(bulkJobId: string, emails: string[], client: ReacherClient) {
  const { jobId } = await client.createBulkJob(emails);

  await prisma.bulkJob.update({
    where: { id: bulkJobId },
    data: {
      mode: "reacher_bulk",
      reacherJobId: jobId
    }
  });

  for (;;) {
    const progress = await client.getBulkProgress(jobId);
    const remoteStatus = getString(progress, ["status", "state", "job_status", "data.status"])?.toLowerCase();
    const processed = getNumber(progress, ["processed", "completed", "checked", "data.processed"]);

    if (processed !== null) {
      await prisma.bulkJob.update({
        where: { id: bulkJobId },
        data: { processed: Math.min(processed, emails.length) }
      });
    }

    if (remoteStatus && ["completed", "complete", "done", "finished", "success"].includes(remoteStatus)) {
      break;
    }

    if (remoteStatus && ["failed", "error", "cancelled", "canceled"].includes(remoteStatus)) {
      throw new Error(`Reacher bulk job ${jobId} ended with status ${remoteStatus}`);
    }

    await sleep(pollIntervalMs);
  }

  const rawResults = normalizeResultArray(await client.getBulkResults(jobId));
  const seen = new Set<string>();

  for (const raw of rawResults) {
    const email = getString(raw, ["email", "to_email", "input", "address", "result.email"]);
    if (!email) continue;

    const normalizedEmail = email.trim().toLowerCase();
    if (!emails.includes(normalizedEmail) || seen.has(normalizedEmail)) continue;

    seen.add(normalizedEmail);
    await storeCompletedEmail(bulkJobId, normalizedEmail, classifyReacherResult(raw), true);
  }

  const missing = emails.filter((email) => !seen.has(email));
  if (missing.length) {
    const records = await prisma.bulkJobEmail.findMany({
      where: { bulkJobId, normalizedEmail: { in: missing } }
    });
    await processWithLocalWorker(bulkJobId, records, client);
    return;
  }

  await completeJob(bulkJobId);
}

async function processWithLocalWorker(
  bulkJobId: string,
  emails: Array<{ id: string; email: string; normalizedEmail: string }>,
  client: ReacherClient
) {
  await prisma.bulkJob.update({
    where: { id: bulkJobId },
    data: { mode: "local_worker" }
  });

  const throttle = createRateLimiter(env.REACHER_REQUESTS_PER_SECOND);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const item = emails[cursor];
      cursor += 1;
      if (!item) return;
      await processOneEmail(bulkJobId, item, client, throttle);
    }
  }

  const workers = Array.from({ length: Math.min(env.BULK_CONCURRENCY, emails.length) }, () => worker());
  await Promise.all(workers);
  await completeJob(bulkJobId);
}

async function processOneEmail(
  bulkJobId: string,
  email: { id: string; email: string; normalizedEmail: string },
  client: ReacherClient,
  throttle: () => Promise<void>
) {
  await prisma.bulkJobEmail.update({
    where: { id: email.id },
    data: { status: "processing", errorMessage: null }
  });

  try {
    const cached = await findCachedResult(email.normalizedEmail);
    if (cached) {
      await storeCompletedEmail(
        bulkJobId,
        email.normalizedEmail,
        {
          category: cached.category,
          isReachable: cached.isReachable,
          syntaxStatus: cached.syntaxStatus,
          mxStatus: cached.mxStatus,
          smtpStatus: cached.smtpStatus,
          smtpResult: cached.smtpResult,
          catchAll: cached.catchAll,
          disposable: cached.disposable,
          roleAccount: cached.roleAccount,
          freeProvider: cached.freeProvider,
          reason: cached.reason ?? "Reused recent verification result",
          rawJson: cached.rawJson
        },
        false
      );
      return;
    }

    await throttle();
    const raw = await client.checkEmail(email.normalizedEmail);
    const classified = classifyReacherResult(raw);

    await prisma.verificationResult.create({
      data: {
        email: email.email,
        normalizedEmail: email.normalizedEmail,
        category: classified.category,
        isReachable: classified.isReachable,
        syntaxStatus: classified.syntaxStatus,
        mxStatus: classified.mxStatus,
        smtpStatus: classified.smtpStatus,
        smtpResult: classified.smtpResult,
        catchAll: classified.catchAll,
        disposable: classified.disposable,
        roleAccount: classified.roleAccount,
        freeProvider: classified.freeProvider,
        reason: classified.reason,
        rawJson: asJson(classified.rawJson),
        source: "bulk"
      }
    });

    await storeCompletedEmail(bulkJobId, email.normalizedEmail, classified, false);
  } catch (error) {
    const classified: ClassifiedReacherResult = {
      category: "unknown",
      isReachable: null,
      syntaxStatus: null,
      mxStatus: null,
      smtpStatus: null,
      smtpResult: null,
      catchAll: null,
      disposable: null,
      roleAccount: null,
      freeProvider: null,
      reason: error instanceof Error ? error.message : "Unknown verification error",
      rawJson: { error: error instanceof Error ? error.message : String(error) }
    };

    await storeCompletedEmail(bulkJobId, email.normalizedEmail, classified, false);
  }
}

async function storeCompletedEmail(
  bulkJobId: string,
  normalizedEmail: string,
  result: ClassifiedReacherResult,
  persistVerificationResult: boolean
) {
  const countField = countFieldForCategory(result.category);

  await prisma.$transaction(async (tx) => {
    const email = await tx.bulkJobEmail.update({
      where: {
        bulkJobId_normalizedEmail: {
          bulkJobId,
          normalizedEmail
        }
      },
      data: {
        status: "completed",
        category: result.category,
        isReachable: result.isReachable,
        syntaxStatus: result.syntaxStatus,
        mxStatus: result.mxStatus,
        smtpStatus: result.smtpStatus,
        smtpResult: result.smtpResult,
        reason: result.reason,
        rawJson: asJson(result.rawJson),
        errorMessage: null,
        checkedAt: new Date()
      }
    });

    if (persistVerificationResult) {
      await tx.verificationResult.create({
        data: {
          email: email.email,
          normalizedEmail: email.normalizedEmail,
          category: result.category,
          isReachable: result.isReachable,
          syntaxStatus: result.syntaxStatus,
          mxStatus: result.mxStatus,
          smtpStatus: result.smtpStatus,
          smtpResult: result.smtpResult,
          catchAll: result.catchAll,
          disposable: result.disposable,
          roleAccount: result.roleAccount,
          freeProvider: result.freeProvider,
          reason: result.reason,
          rawJson: asJson(result.rawJson),
          source: "bulk"
        }
      });
    }

    await tx.bulkJob.update({
      where: { id: bulkJobId },
      data: {
        processed: { increment: 1 },
        [countField]: { increment: 1 }
      }
    });
  });
}

async function findCachedResult(normalizedEmail: string) {
  if (env.VERIFICATION_CACHE_DAYS <= 0) return null;

  const since = new Date(Date.now() - env.VERIFICATION_CACHE_DAYS * 24 * 60 * 60 * 1000);
  return prisma.verificationResult.findFirst({
    where: {
      normalizedEmail,
      createdAt: { gte: since }
    },
    orderBy: { createdAt: "desc" }
  });
}

async function completeJob(bulkJobId: string) {
  await prisma.bulkJob.update({
    where: { id: bulkJobId },
    data: {
      status: "completed",
      processed: await prisma.bulkJobEmail.count({
        where: { bulkJobId, status: "completed" }
      }),
      completedAt: new Date()
    }
  });
}

async function failJob(bulkJobId: string, error: unknown) {
  await prisma.bulkJob.update({
    where: { id: bulkJobId },
    data: {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      completedAt: new Date()
    }
  });
}

function countFieldForCategory(category: ClassifiedReacherResult["category"]) {
  switch (category) {
    case "valid":
      return "validCount";
    case "invalid":
      return "invalidCount";
    case "risky":
      return "riskyCount";
    default:
      return "unknownCount";
  }
}

function createRateLimiter(requestsPerSecond: number) {
  const interval = Math.max(1000 / Math.max(requestsPerSecond, 1), 0);
  let last = 0;
  let queue = Promise.resolve();

  return async () => {
    queue = queue.then(async () => {
      const wait = Math.max(0, interval - (Date.now() - last));
      if (wait) await sleep(wait);
      last = Date.now();
    });

    return queue;
  };
}

function normalizeResultArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const direct = (raw as Record<string, unknown>).results;
    if (Array.isArray(direct)) return direct;

    const dataResults = getValue(raw, "data.results");
    if (Array.isArray(dataResults)) return dataResults;
  }

  return [];
}

function getValue(source: unknown, path: string): unknown {
  if (!source || typeof source !== "object") return undefined;

  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function getString(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = getValue(source, path);
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }

  return null;
}

function getNumber(source: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = getValue(source, path);
    if (typeof value === "number") return value;
    if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  }

  return null;
}

