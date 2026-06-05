export type VerificationCategory = "valid" | "invalid" | "risky" | "unknown";

export type ClassifiedReacherResult = {
  category: VerificationCategory;
  isReachable: boolean | null;
  syntaxStatus: string | null;
  mxStatus: string | null;
  smtpStatus: string | null;
  smtpResult: string | null;
  catchAll: boolean | null;
  disposable: boolean | null;
  roleAccount: boolean | null;
  freeProvider: boolean | null;
  reason: string;
  rawJson: unknown;
};

const invalidSignals = [
  "invalid",
  "rejected",
  "mailbox_not_found",
  "no_mailbox",
  "does_not_exist",
  "domain_not_found",
  "no_mx",
  "syntax_error",
  "undeliverable"
];

const riskySignals = [
  "catch_all",
  "catch-all",
  "accept_all",
  "accept-all",
  "greylisted",
  "graylisted",
  "timeout",
  "temporary",
  "risky",
  "role_account",
  "disposable"
];

const validSignals = ["safe", "deliverable", "reachable", "valid", "yes", "ok", "true"];

function getValue(source: unknown, path: string): unknown {
  if (!source || typeof source !== "object") return undefined;

  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function firstValue(source: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = getValue(source, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }

  return undefined;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "safe", "reachable", "deliverable", "valid"].includes(normalized)) return true;
    if (["false", "no", "invalid", "unreachable", "undeliverable"].includes(normalized)) return false;
  }

  return null;
}

function containsAny(values: Array<string | null>, signals: string[]) {
  const haystack = values
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return signals.some((signal) => haystack.includes(signal));
}

export function classifyReacherResult(rawResult: unknown): ClassifiedReacherResult {
  const isReachableRaw = firstValue(rawResult, [
    "is_reachable",
    "isReachable",
    "result.is_reachable",
    "result.isReachable",
    "status",
    "safe_to_send",
    "deliverability"
  ]);

  const syntaxRaw = firstValue(rawResult, [
    "syntax.status",
    "syntax.result",
    "syntax.is_valid_syntax",
    "syntax.isValidSyntax",
    "syntax",
    "is_valid_syntax"
  ]);

  const mxRaw = firstValue(rawResult, [
    "mx.status",
    "mx.result",
    "mx.accepts_mail",
    "mx.acceptsMail",
    "mx"
  ]);

  const smtpRaw = firstValue(rawResult, [
    "smtp.status",
    "smtp.result",
    "smtp.is_deliverable",
    "smtp.can_connect_smtp",
    "smtp"
  ]);

  const smtpResult = asString(
    firstValue(rawResult, ["smtp_result", "smtp.result", "smtp.response", "smtp.message", "reason"])
  );

  const catchAll = asBoolean(firstValue(rawResult, ["is_catch_all", "catch_all", "catchAll", "mx.is_catch_all"]));
  const disposable = asBoolean(firstValue(rawResult, ["is_disposable", "disposable", "misc.is_disposable"]));
  const roleAccount = asBoolean(firstValue(rawResult, ["is_role_account", "role_account", "misc.is_role_account"]));
  const freeProvider = asBoolean(firstValue(rawResult, ["is_free_email", "free_provider", "misc.is_free_email"]));

  const isReachable = asBoolean(isReachableRaw);
  const syntaxStatus = asString(syntaxRaw);
  const mxStatus = asString(mxRaw);
  const smtpStatus = asString(smtpRaw);

  const signals = [asString(isReachableRaw), syntaxStatus, mxStatus, smtpStatus, smtpResult];

  let category: VerificationCategory = "unknown";
  let reason = "No conclusive Reacher result";

  if (asBoolean(syntaxRaw) === false || containsAny(signals, invalidSignals)) {
    category = "invalid";
    reason = "Reacher reported invalid syntax, domain, SMTP, or mailbox";
  } else if (catchAll || disposable || roleAccount || containsAny(signals, riskySignals)) {
    category = "risky";
    reason = "Mailbox appears risky or inconclusive despite a reachable domain";
  } else if (isReachable === true || containsAny(signals, validSignals)) {
    category = "valid";
    reason = "Reacher reported the mailbox as reachable or deliverable";
  }

  return {
    category,
    isReachable,
    syntaxStatus,
    mxStatus,
    smtpStatus,
    smtpResult,
    catchAll,
    disposable,
    roleAccount,
    freeProvider,
    reason,
    rawJson: rawResult
  };
}

