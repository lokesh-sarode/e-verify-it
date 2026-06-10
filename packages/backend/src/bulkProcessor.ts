import { Prisma, type BulkJobEmail } from "@prisma/client";
import { classifyReacherResult, type ClassifiedReacherResult } from "./classifier";
import { env } from "./env";
import { enqueueBulkJob } from "./queue";
import { prisma } from "./prisma";
import { ReacherClient } from "./reacher";
import type { PreparedBulkUpload } from "./fastFilter";

const createManyBatchSize = 1000;

function asJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export async function createBulkJobFromUpload(filename: string, parsed: PreparedBulkUpload, adminId?: string) {
  const initialCounts = countsForPrefilteredEmails(parsed);
  const bulkJob = await prisma.bulkJob.create({
    data: {
      filename,
      originalRows: parsed.originalRows,
      emptyRows: parsed.emptyRows,
      duplicateRows: parsed.duplicateRows,
      syntaxInvalidRows: parsed.syntaxInvalidRows,
      uniqueEmails: parsed.uniqueEmails.length,
      reacherEmails: parsed.reacherEmails.length,
      prefilteredEmails: parsed.prefilteredEmails.length,
      noMxRows: parsed.noMxRows,
      disposableRows: parsed.disposableRows,
      mxLookupFailedRows: parsed.mxLookupFailedRows,
      processed: parsed.prefilteredEmails.length,
      validCount: initialCounts.valid,
      invalidCount: initialCounts.invalid,
      riskyCount: initialCounts.risky,
      unknownCount: initialCounts.unknown,
      status: parsed.reacherEmails.length === 0 ? "completed" : "pending",
      completedAt: parsed.reacherEmails.length === 0 ? new Date() : null
    }
  });

  try {
    for (const chunk of chunks(parsed.reacherEmails, createManyBatchSize)) {
      await prisma.bulkJobEmail.createMany({
        data: chunk.map((email) => ({
          bulkJobId: bulkJob.id,
          email: email.email,
          normalizedEmail: email.normalizedEmail
        }))
      });
    }

    for (const chunk of chunks(parsed.prefilteredEmails, createManyBatchSize)) {
      await prisma.bulkJobEmail.createMany({
        data: chunk.map((email) => ({
          bulkJobId: bulkJob.id,
          email: email.email,
          normalizedEmail: email.normalizedEmail,
          status: "completed",
          category: email.result.category,
          isReachable: email.result.isReachable,
          syntaxStatus: email.result.syntaxStatus,
          mxStatus: email.result.mxStatus,
          smtpStatus: email.result.smtpStatus,
          smtpResult: email.result.smtpResult,
          catchAll: email.result.catchAll,
          disposable: email.result.disposable,
          roleAccount: email.result.roleAccount,
          freeProvider: email.result.freeProvider,
          reason: email.result.reason,
          rawJson: asJson(email.result.rawJson),
          checkedAt: new Date()
        }))
      });

      await prisma.verificationResult.createMany({
        data: chunk.map((email) => ({
          email: email.email,
          normalizedEmail: email.normalizedEmail,
          category: email.result.category,
          isReachable: email.result.isReachable,
          syntaxStatus: email.result.syntaxStatus,
          mxStatus: email.result.mxStatus,
          smtpStatus: email.result.smtpStatus,
          smtpResult: email.result.smtpResult,
          catchAll: email.result.catchAll,
          disposable: email.result.disposable,
          roleAccount: email.result.roleAccount,
          freeProvider: email.result.freeProvider,
          reason: email.result.reason,
          rawJson: asJson(email.result.rawJson),
          source: "bulk"
        }))
      });
    }

    for (const chunk of chunks(parsed.rejectedRows, createManyBatchSize)) {
      await prisma.uploadRejectedRow.createMany({
        data: chunk.map((row) => ({
          bulkJobId: bulkJob.id,
          rowNumber: row.rowNumber,
          emailRaw: row.emailRaw,
          reason: row.reason
        }))
      });
    }

    await prisma.auditLog.create({
      data: {
        adminId,
        action: "upload",
        meta: {
          bulkJobId: bulkJob.id,
          filename,
          originalRows: parsed.originalRows,
          uniqueEmails: parsed.uniqueEmails.length,
          reacherEmails: parsed.reacherEmails.length,
          prefilteredEmails: parsed.prefilteredEmails.length
        }
      }
    });
  } catch (error) {
    await prisma.bulkJob.update({
      where: { id: bulkJob.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date()
      }
    }).catch(() => undefined);
    throw error;
  }

  if (parsed.reacherEmails.length > 0) {
    try {
      await enqueueBulkJob(bulkJob.id);
    } catch {
      await prisma.bulkJob.update({
        where: { id: bulkJob.id },
        data: {
          status: "failed",
          errorMessage: "Bulk job was saved, but Redis/BullMQ could not enqueue it. Check REDIS_URL and worker logs.",
          completedAt: new Date()
        }
      });
      throw new Error("Bulk job was saved, but Redis/BullMQ could not enqueue it. Check REDIS_URL and worker logs.");
    }
  }

  return bulkJob;
}

export async function submitBulkJobToReacher(bulkJobId: string) {
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
    await completeJobFromStoredResults(bulkJobId);
    return;
  }

  try {
    await submitWithReacherBulk(bulkJobId, emails, new ReacherClient());
  } catch (error) {
    await failJob(bulkJobId, error);
    throw error;
  }
}

export async function pollActiveReacherBulkJobs(client = new ReacherClient()) {
  const jobs = await prisma.bulkJob.findMany({
    where: {
      status: "processing",
      reacherJobId: { not: null }
    },
    orderBy: { startedAt: "asc" },
    take: 25
  });

  for (const job of jobs) {
    try {
      await pollReacherBulkJob(job.id, client);
    } catch (error) {
      await prisma.bulkJob.update({
        where: { id: job.id },
        data: {
          errorMessage: `Polling failed and will retry: ${error instanceof Error ? error.message : String(error)}`
        }
      });
    }
  }
}

export async function pollReacherBulkJob(bulkJobId: string, client = new ReacherClient()) {
  const job = await prisma.bulkJob.findUnique({ where: { id: bulkJobId } });
  if (!job || job.status !== "processing" || !job.reacherJobId) return;

  const progress = readBulkProgress(await client.getBulkProgress(job.reacherJobId), job.reacherEmails);
  await updateJobFromRemoteProgress(bulkJobId, progress);

  if (progress.status === "failed") {
    await failJob(bulkJobId, `Reacher bulk job ${job.reacherJobId} ended with status ${progress.rawStatus ?? "failed"}`);
    return;
  }

  if (progress.status !== "completed") return;

  const emails = await prisma.bulkJobEmail.findMany({
    where: { bulkJobId, status: { in: ["pending", "failed"] } },
    orderBy: { createdAt: "asc" }
  });

  await saveCompletedReacherResults(bulkJobId, job.reacherJobId, emails, client);
}

async function submitWithReacherBulk(bulkJobId: string, emails: BulkJobEmail[], client: ReacherClient) {
  const normalizedEmails = emails.map((email) => email.normalizedEmail);
  const { jobId } = await client.createBulkJob(normalizedEmails);

  await prisma.bulkJob.update({
    where: { id: bulkJobId },
    data: {
      mode: "reacher_bulk",
      reacherJobId: jobId
    }
  });
}

async function saveCompletedReacherResults(
  bulkJobId: string,
  jobId: string,
  emails: BulkJobEmail[],
  client: ReacherClient
) {
  const emailByNormalized = new Map(emails.map((email) => [email.normalizedEmail, email]));
  const rawResults = await fetchAllBulkResults(client, jobId, emails.length);
  const seen = new Set<string>();

  for (const raw of rawResults) {
    const normalizedEmail = normalizeResultEmail(raw);
    if (!normalizedEmail || seen.has(normalizedEmail) || !emailByNormalized.has(normalizedEmail)) continue;

    seen.add(normalizedEmail);
    await storeCompletedEmail(bulkJobId, normalizedEmail, classifyReacherResult(raw), true, false);
  }

  for (const email of emails) {
    if (seen.has(email.normalizedEmail)) continue;

    await storeCompletedEmail(
      bulkJobId,
      email.normalizedEmail,
      {
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
        reason: "Reacher bulk results did not include this email",
        rawJson: { error: "missing_result", reacherJobId: jobId }
      },
      false,
      false
    );
  }

  await completeJobFromStoredResults(bulkJobId);
}

async function fetchAllBulkResults(client: ReacherClient, jobId: string, expectedTotal: number) {
  const allResults: unknown[] = [];
  let offset = 0;

  for (;;) {
    const page = await client.getBulkResultsPage(jobId, {
      limit: env.REACHER_BULK_RESULTS_PAGE_SIZE,
      offset
    });
    const results = normalizeResultArray(page);

    if (!results.length) break;
    allResults.push(...results);

    if (results.length < env.REACHER_BULK_RESULTS_PAGE_SIZE || allResults.length >= expectedTotal) break;
    offset += results.length;
  }

  return allResults;
}

async function storeCompletedEmail(
  bulkJobId: string,
  normalizedEmail: string,
  result: ClassifiedReacherResult,
  persistVerificationResult: boolean,
  incrementJobCounts: boolean
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
        catchAll: result.catchAll,
        disposable: result.disposable,
        roleAccount: result.roleAccount,
        freeProvider: result.freeProvider,
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

    if (incrementJobCounts) {
      await tx.bulkJob.update({
        where: { id: bulkJobId },
        data: {
          processed: { increment: 1 },
          [countField]: { increment: 1 }
        }
      });
    }
  });
}

async function completeJobFromStoredResults(bulkJobId: string) {
  const counts = await completedCountsForJob(bulkJobId);

  await prisma.bulkJob.update({
    where: { id: bulkJobId },
    data: {
      status: "completed",
      processed: counts.total,
      validCount: counts.valid,
      invalidCount: counts.invalid,
      riskyCount: counts.risky,
      unknownCount: counts.unknown,
      completedAt: new Date()
    }
  });
}

async function completedCountsForJob(bulkJobId: string) {
  const grouped = await prisma.bulkJobEmail.groupBy({
    by: ["category"],
    where: { bulkJobId, status: "completed" },
    _count: { _all: true }
  });

  const counts = {
    valid: 0,
    invalid: 0,
    risky: 0,
    unknown: 0
  };

  for (const group of grouped) {
    if (group.category) counts[group.category] = group._count._all;
  }

  return {
    ...counts,
    total: counts.valid + counts.invalid + counts.risky + counts.unknown
  };
}

async function updateJobFromRemoteProgress(bulkJobId: string, progress: RemoteBulkProgress) {
  const storedCounts = await completedCountsForJob(bulkJobId);

  await prisma.bulkJob.update({
    where: { id: bulkJobId },
    data: {
      processed: storedCounts.total + progress.processed,
      validCount: storedCounts.valid + progress.valid,
      invalidCount: storedCounts.invalid + progress.invalid,
      riskyCount: storedCounts.risky + progress.risky,
      unknownCount: storedCounts.unknown + progress.unknown,
      errorMessage: null
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

function countsForPrefilteredEmails(parsed: PreparedBulkUpload) {
  return parsed.prefilteredEmails.reduce(
    (counts, email) => {
      counts[email.result.category] += 1;
      return counts;
    },
    {
      valid: 0,
      invalid: 0,
      risky: 0,
      unknown: 0
    }
  );
}

type RemoteBulkProgress = {
  status: "running" | "completed" | "failed";
  rawStatus: string | null;
  processed: number;
  valid: number;
  invalid: number;
  risky: number;
  unknown: number;
};

function readBulkProgress(raw: unknown, expectedTotal: number): RemoteBulkProgress {
  const rawStatus = getString(raw, ["job_status", "status", "state", "data.job_status", "data.status"]);
  const normalizedStatus = rawStatus?.toLowerCase() ?? "";
  const processed = getNumber(raw, ["total_processed", "processed", "completed", "checked", "data.total_processed"]) ?? 0;
  const total = getNumber(raw, ["total_records", "total", "data.total_records"]) ?? expectedTotal;

  return {
    status: normalizeRemoteStatus(normalizedStatus, processed, total, getString(raw, ["finished_at", "data.finished_at"])),
    rawStatus,
    processed: Math.min(processed, total),
    valid: getNumber(raw, ["summary.total_safe", "summary.valid", "data.summary.total_safe"]) ?? 0,
    invalid: getNumber(raw, ["summary.total_invalid", "summary.invalid", "data.summary.total_invalid"]) ?? 0,
    risky: getNumber(raw, ["summary.total_risky", "summary.risky", "data.summary.total_risky"]) ?? 0,
    unknown: getNumber(raw, ["summary.total_unknown", "summary.unknown", "data.summary.total_unknown"]) ?? 0
  };
}

function normalizeRemoteStatus(status: string, processed: number, total: number, finishedAt: string | null) {
  if (["completed", "complete", "done", "finished", "success"].includes(status) || finishedAt) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(status)) return "failed";
  if (total > 0 && processed >= total) return "completed";
  return "running";
}

function normalizeResultArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const direct = (raw as Record<string, unknown>).results;
    if (Array.isArray(direct)) return direct;
    if (direct && typeof direct === "object") return [direct];

    const dataResults = getValue(raw, "data.results");
    if (Array.isArray(dataResults)) return dataResults;
    if (dataResults && typeof dataResults === "object") return [dataResults];
  }

  return [];
}

function normalizeResultEmail(raw: unknown): string | null {
  return getString(raw, ["input", "email", "to_email", "address", "result.input", "result.email"])?.trim().toLowerCase() ?? null;
}

function getValue(source: unknown, path: string): unknown {
  if (!source || typeof source !== "object") return undefined;

  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function getString(source: unknown, paths: string[]): string | null {
  if (typeof source === "string" && source.trim()) return source;

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

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}
