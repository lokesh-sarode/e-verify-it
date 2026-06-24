import { resolveMx } from "node:dns/promises";
import disposableDomains from "disposable-email-domains";
import type { ClassifiedReacherResult } from "./classifier";
import { env } from "./env";

type MxLookupResult =
  | { status: "ok"; records: string[] }
  | { status: "no_mx"; errorCode?: string; errorMessage?: string }
  | { status: "temporary_error"; errorCode?: string; errorMessage?: string };

type MxLookupCache = Map<string, Promise<MxLookupResult>>;

const disposableDomainSet = new Set(disposableDomains.map((domain) => domain.toLowerCase()));
const roleAccountNames = new Set([
  "abuse",
  "admin",
  "billing",
  "careers",
  "contact",
  "customerservice",
  "hello",
  "help",
  "hr",
  "info",
  "jobs",
  "marketing",
  "media",
  "no-reply",
  "noreply",
  "office",
  "postmaster",
  "privacy",
  "recruiting",
  "sales",
  "security",
  "support",
  "team",
  "webmaster"
]);

export function createEmailPrefilter() {
  const mxCache: MxLookupCache = new Map();
  return (normalizedEmail: string) => prefilterEmail(normalizedEmail, mxCache);
}

export async function prefilterEmail(
  normalizedEmail: string,
  mxCache?: MxLookupCache
): Promise<ClassifiedReacherResult | null> {
  const [username, domain] = splitEmail(normalizedEmail);

  if (!username || !domain) {
    return prefilterResult(normalizedEmail, {
      category: "invalid",
      isReachable: false,
      syntaxStatus: "false",
      mxStatus: null,
      reason: "Invalid email syntax",
      rawJson: {
        source: "local_pre_filter",
        input: normalizedEmail,
        syntax: { is_valid_syntax: false }
      }
    });
  }

  const mxLookup = await lookupMx(domain, mxCache);

  if (mxLookup.status === "no_mx") {
    return prefilterResult(normalizedEmail, {
      category: "invalid",
      isReachable: false,
      syntaxStatus: "true",
      mxStatus: "false",
      reason: "Domain does not have usable MX records",
      rawJson: {
        source: "local_pre_filter",
        input: normalizedEmail,
        syntax: { is_valid_syntax: true, username, domain, address: normalizedEmail },
        mx: {
          accepts_mail: false,
          records: [],
          error: { type: mxLookup.errorCode ?? "NoMx", message: mxLookup.errorMessage ?? "No MX records found" }
        },
        is_reachable: "invalid"
      }
    });
  }

  if (mxLookup.status === "temporary_error") {
    return prefilterResult(normalizedEmail, {
      category: "unknown",
      isReachable: null,
      syntaxStatus: "true",
      mxStatus: null,
      reason: "DNS/MX lookup temporarily failed before SMTP verification",
      rawJson: {
        source: "local_pre_filter",
        input: normalizedEmail,
        syntax: { is_valid_syntax: true, username, domain, address: normalizedEmail },
        mx: {
          accepts_mail: null,
          records: [],
          error: { type: mxLookup.errorCode ?? "TemporaryDnsError", message: mxLookup.errorMessage ?? "MX lookup failed" }
        },
        is_reachable: "unknown"
      }
    });
  }

  if (isDisposableDomain(domain)) {
    return prefilterResult(normalizedEmail, {
      category: "risky",
      isReachable: null,
      syntaxStatus: "true",
      mxStatus: "true",
      disposable: true,
      reason: "Disposable email domain was filtered before SMTP verification",
      rawJson: {
        source: "local_pre_filter",
        input: normalizedEmail,
        syntax: { is_valid_syntax: true, username, domain, address: normalizedEmail },
        mx: { accepts_mail: true, records: mxLookup.records },
        misc: { is_disposable: true, is_role_account: isRoleAccount(username) },
        is_reachable: "risky"
      }
    });
  }

  if (isRoleAccount(username)) {
    return prefilterResult(normalizedEmail, {
      category: "risky",
      isReachable: null,
      syntaxStatus: "true",
      mxStatus: "true",
      roleAccount: true,
      reason: "Role-based address was filtered before SMTP verification",
      rawJson: {
        source: "local_pre_filter",
        input: normalizedEmail,
        syntax: { is_valid_syntax: true, username, domain, address: normalizedEmail },
        mx: { accepts_mail: true, records: mxLookup.records },
        misc: { is_disposable: false, is_role_account: true },
        is_reachable: "risky"
      }
    });
  }

  return null;
}

function splitEmail(normalizedEmail: string): [string | null, string | null] {
  const atIndex = normalizedEmail.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === normalizedEmail.length - 1) return [null, null];
  return [normalizedEmail.slice(0, atIndex), normalizedEmail.slice(atIndex + 1)];
}

async function lookupMx(domain: string, cache?: MxLookupCache): Promise<MxLookupResult> {
  const normalizedDomain = domain.toLowerCase();

  if (cache?.has(normalizedDomain)) {
    return cache.get(normalizedDomain)!;
  }

  const lookup = resolveMxForDomain(normalizedDomain);
  cache?.set(normalizedDomain, lookup);
  return lookup;
}

async function resolveMxForDomain(domain: string): Promise<MxLookupResult> {
  try {
    const records = await withTimeout(resolveMx(domain), env.DNS_LOOKUP_TIMEOUT_MS);
    const exchanges = records.map((record) => record.exchange?.replace(/\.$/, "").toLowerCase()).filter(Boolean);

    return exchanges.length > 0 ? { status: "ok", records: exchanges } : { status: "no_mx" };
  } catch (error) {
    const code = errorCode(error);
    const message = error instanceof Error ? error.message : String(error);

    if (["ENODATA", "ENOTFOUND", "EAI_NODATA"].includes(code ?? "")) {
      return { status: "no_mx", errorCode: code ?? undefined, errorMessage: message };
    }

    return { status: "temporary_error", errorCode: code ?? undefined, errorMessage: message };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`DNS lookup timed out after ${timeoutMs} ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isDisposableDomain(domain: string) {
  const parts = domain.toLowerCase().split(".");

  for (let index = 0; index < parts.length - 1; index += 1) {
    if (disposableDomainSet.has(parts.slice(index).join("."))) return true;
  }

  return false;
}

function isRoleAccount(username: string) {
  return roleAccountNames.has(username.toLowerCase());
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function prefilterResult(
  normalizedEmail: string,
  result: Omit<ClassifiedReacherResult, "smtpStatus" | "smtpResult" | "catchAll" | "disposable" | "roleAccount" | "freeProvider">
    & Partial<Pick<ClassifiedReacherResult, "smtpStatus" | "smtpResult" | "catchAll" | "disposable" | "roleAccount" | "freeProvider">>
): ClassifiedReacherResult {
  return {
    smtpStatus: null,
    smtpResult: null,
    catchAll: null,
    disposable: null,
    roleAccount: null,
    freeProvider: null,
    ...result,
    rawJson: {
      ...(typeof result.rawJson === "object" && result.rawJson ? result.rawJson : {}),
      normalized_email: normalizedEmail
    }
  };
}
