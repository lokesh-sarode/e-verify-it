import { promises as dns } from "node:dns";
import disposableDomains from "disposable-email-domains";
import type { ClassifiedReacherResult } from "./classifier";
import type { ParsedUpload } from "./uploadParser";

export type PreparedUploadEmail = {
  email: string;
  normalizedEmail: string;
};

export type PrefilteredUploadEmail = PreparedUploadEmail & {
  result: ClassifiedReacherResult;
};

export type PreparedBulkUpload = ParsedUpload & {
  prefilteredEmails: PrefilteredUploadEmail[];
  reacherEmails: PreparedUploadEmail[];
  noMxRows: number;
  disposableRows: number;
  mxLookupFailedRows: number;
};

type MxLookupResult =
  | { status: "ok"; records: Array<{ exchange: string; priority: number }> }
  | { status: "no_mx"; errorCode?: string; message?: string }
  | { status: "temporary_failure"; errorCode?: string; message?: string };

const disposableDomainSet = new Set(disposableDomains.map((domain) => domain.toLowerCase()));
const mxLookupTimeoutMs = 3000;
const mxLookupConcurrency = 25;

export async function prepareBulkUpload(parsed: ParsedUpload): Promise<PreparedBulkUpload> {
  const domains = Array.from(
    new Set(parsed.uniqueEmails.map((email) => domainFromEmail(email.normalizedEmail)).filter((domain): domain is string => Boolean(domain)))
  );
  const mxByDomain = await lookupDomains(domains);
  const prefilteredEmails: PrefilteredUploadEmail[] = [];
  const reacherEmails: PreparedUploadEmail[] = [];
  let noMxRows = 0;
  let disposableRows = 0;
  let mxLookupFailedRows = 0;

  for (const email of parsed.uniqueEmails) {
    const domain = domainFromEmail(email.normalizedEmail);
    const mx = domain ? mxByDomain.get(domain) : { status: "no_mx", message: "Email domain is missing" } satisfies MxLookupResult;

    if (!domain || !mx || mx.status === "no_mx") {
      const noMx = mx?.status === "no_mx" ? mx : null;
      noMxRows += 1;
      prefilteredEmails.push({
        ...email,
        result: stageResult({
          category: "invalid",
          reason: "Domain does not publish MX records",
          mxStatus: "no_mx",
          rawJson: {
            source: "stage1",
            check: "mx",
            domain,
            errorCode: noMx?.errorCode,
            message: noMx?.message
          }
        })
      });
      continue;
    }

    if (mx.status === "temporary_failure") {
      mxLookupFailedRows += 1;
      prefilteredEmails.push({
        ...email,
        result: stageResult({
          category: "unknown",
          reason: "MX lookup failed temporarily",
          mxStatus: "temporary_failure",
          rawJson: {
            source: "stage1",
            check: "mx",
            domain,
            errorCode: mx.errorCode,
            message: mx.message
          }
        })
      });
      continue;
    }

    if (domain && isDisposableDomain(domain)) {
      disposableRows += 1;
      prefilteredEmails.push({
        ...email,
        result: stageResult({
          category: "risky",
          reason: "Disposable email domain",
          mxStatus: "valid",
          disposable: true,
          rawJson: {
            source: "stage1",
            check: "disposable_domain",
            domain,
            mxRecords: mx.records
          }
        })
      });
      continue;
    }

    reacherEmails.push(email);
  }

  return {
    ...parsed,
    prefilteredEmails,
    reacherEmails,
    noMxRows,
    disposableRows,
    mxLookupFailedRows
  };
}

function stageResult(options: {
  category: ClassifiedReacherResult["category"];
  reason: string;
  mxStatus: string | null;
  rawJson: unknown;
  disposable?: boolean | null;
}): ClassifiedReacherResult {
  return {
    category: options.category,
    isReachable: options.category === "invalid" ? false : null,
    syntaxStatus: "valid",
    mxStatus: options.mxStatus,
    smtpStatus: null,
    smtpResult: null,
    catchAll: null,
    disposable: options.disposable ?? null,
    roleAccount: null,
    freeProvider: null,
    reason: options.reason,
    rawJson: options.rawJson
  };
}

function isDisposableDomain(domain: string) {
  if (disposableDomainSet.has(domain)) return true;

  const parts = domain.split(".");
  for (let index = 1; index < parts.length - 1; index += 1) {
    if (disposableDomainSet.has(parts.slice(index).join("."))) return true;
  }

  return false;
}

function domainFromEmail(email: string) {
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0 || atIndex === email.length - 1) return null;
  return email.slice(atIndex + 1).toLowerCase();
}

async function lookupDomains(domains: string[]) {
  const results = new Map<string, MxLookupResult>();
  await mapWithConcurrency(domains, mxLookupConcurrency, async (domain) => {
    results.set(domain, await lookupMx(domain));
  });
  return results;
}

async function lookupMx(domain: string): Promise<MxLookupResult> {
  try {
    const records = await withTimeout(dns.resolveMx(domain), mxLookupTimeoutMs);
    if (!records.length) return { status: "no_mx" };
    return { status: "ok", records };
  } catch (error) {
    const code = readErrorCode(error);
    const message = error instanceof Error ? error.message : String(error);

    if (["ENODATA", "ENOTFOUND", "ENONAME"].includes(code ?? "")) {
      return { status: "no_mx", errorCode: code ?? undefined, message };
    }

    return { status: "temporary_failure", errorCode: code ?? undefined, message };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`MX lookup timed out after ${timeoutMs} ms`);
      (error as Error & { code?: string }).code = "ETIMEOUT";
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function readErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await worker(items[current]);
    }
  });

  await Promise.all(workers);
}
