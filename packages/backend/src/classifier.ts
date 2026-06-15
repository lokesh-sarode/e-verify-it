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
  "no such user",
  "user unknown",
  "unknown user",
  "invalid recipient",
  "recipient address rejected",
  "mailbox unavailable",
  "mailbox disabled",
  "account disabled",
  "unreachable",
  "not_reachable",
  "does_not_exist",
  "does not exist",
  "not deliverable",
  "domain_not_found",
  "host_not_found",
  "name does not resolve",
  "no_mx",
  "syntax_error",
  "undeliverable",
  "550",
  "551",
  "553",
  "5.1.1"
];

const riskySignals = [
  "catch_all",
  "catch-all",
  "accept_all",
  "accept-all",
  "greylisted",
  "graylisted",
  "timeout",
  "timed out",
  "temporary",
  "temporarily",
  "risky",
  "role_account",
  "disposable",
  "headless",
  "browser",
  "webdriver",
  "disconnected",
  "connection reset",
  "try again",
  "451",
  "452",
  "4.2.0",
  "4.2.1"
];

const safeReachableSignals = ["safe", "deliverable", "reachable"];
const unknownSignals = ["unknown", "inconclusive", "insufficient"];
const temporaryDnsSignals = ["temporary failure in name resolution", "eai_again", "servfail"];

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

function normalizedText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return String(value).trim().toLowerCase();
  }

  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return null;
  }
}

function hasAnySignal(value: string | null, signals: string[]) {
  if (!value) return false;
  return signals.some((signal) => value.includes(signal));
}

function hasRecords(value: unknown): boolean | null {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() ? true : null;
  return null;
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

  const mxRecordsRaw = firstValue(rawResult, ["mx.records", "mx.mx_records", "mxRecords"]);
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

  const smtpDeliverableRaw = firstValue(rawResult, [
    "smtp.is_deliverable",
    "smtp.deliverable",
    "smtp.can_deliver",
    "smtp.accepted",
    "is_deliverable"
  ]);
  const smtpDisabledRaw = firstValue(rawResult, ["smtp.is_disabled", "smtp.disabled", "smtp.account_disabled"]);
  const smtpErrorRaw = firstValue(rawResult, ["smtp.error", "smtp_error", "error.smtp"]);
  const smtpErrorType = asString(firstValue(rawResult, ["smtp.error.type", "smtp.error.name", "smtp_error.type"]));
  const smtpErrorMessage = normalizedText(firstValue(rawResult, ["smtp.error.message", "smtp.error", "smtp_error.message", "smtp_error"]));

  const smtpResult = asString(
    firstValue(rawResult, ["smtp_result", "smtp.result", "smtp.response", "smtp.message", "smtp.error.message", "reason"])
  );

  const catchAll = asBoolean(firstValue(rawResult, ["is_catch_all", "catch_all", "catchAll", "smtp.is_catch_all", "mx.is_catch_all"]));
  const disposable = asBoolean(firstValue(rawResult, ["is_disposable", "disposable", "misc.is_disposable"]));
  const roleAccount = asBoolean(firstValue(rawResult, ["is_role_account", "role_account", "misc.is_role_account"]));
  const freeProvider = asBoolean(firstValue(rawResult, ["is_free_email", "free_provider", "misc.is_free_email"]));

  const isReachable = asBoolean(isReachableRaw);
  const syntaxValid = asBoolean(syntaxRaw);
  const mxAcceptsMail = asBoolean(mxRaw);
  const mxRecordStatus = hasRecords(mxRecordsRaw);
  const smtpDeliverable = asBoolean(smtpDeliverableRaw);
  const smtpDisabled = asBoolean(smtpDisabledRaw);
  const hasSmtpError = Boolean(smtpErrorRaw);
  const reacherText = normalizedText(isReachableRaw);
  const smtpText = [
    normalizedText(smtpRaw),
    normalizedText(smtpResult),
    smtpErrorType?.toLowerCase() ?? null,
    smtpErrorMessage
  ].filter(Boolean).join(" ");

  const syntaxStatus = syntaxValid === null ? asString(syntaxRaw) : String(syntaxValid);
  const mxStatus = mxAcceptsMail === null ? asString(mxRaw) : String(mxAcceptsMail);
  const smtpStatus = smtpErrorType ? `error:${smtpErrorType}` : asString(smtpRaw);

  const hardInvalid = hasAnySignal(reacherText, invalidSignals) || hasAnySignal(smtpText, invalidSignals);
  const risky = hasAnySignal(reacherText, riskySignals) || hasAnySignal(smtpText, riskySignals);
  const temporaryDnsIssue = hasAnySignal(smtpText, temporaryDnsSignals);
  const reacherSafe = hasAnySignal(reacherText, safeReachableSignals);
  const reacherUnknown = hasAnySignal(reacherText, unknownSignals);

  let category: VerificationCategory = "unknown";
  let reason = "No conclusive Reacher result";

  if (syntaxValid === false) {
    category = "invalid";
    reason = "Invalid email syntax";
  } else if (mxAcceptsMail === false || mxRecordStatus === false) {
    category = "invalid";
    reason = "Domain does not have usable MX records";
  } else if (smtpDisabled === true) {
    category = "invalid";
    reason = "SMTP reported the mailbox as disabled";
  } else if (smtpDeliverable === false && !hasSmtpError) {
    category = "invalid";
    reason = "SMTP reported the mailbox as not deliverable";
  } else if (isReachable === false || hardInvalid) {
    category = "invalid";
    reason = "Reacher or SMTP reported the mailbox as invalid";
  } else if (catchAll || disposable || roleAccount) {
    category = "risky";
    reason = "Mailbox is deliverable only with risk flags";
  } else if (temporaryDnsIssue) {
    category = "unknown";
    reason = "DNS lookup had a temporary failure";
  } else if (risky) {
    category = "risky";
    reason = "SMTP verification returned a temporary or inconclusive risk signal";
  } else if (smtpDeliverable === true) {
    category = "valid";
    reason = "SMTP reported the mailbox as deliverable";
  } else if (reacherSafe && !hasSmtpError) {
    category = "valid";
    reason = "Reacher reported the mailbox as safe with no SMTP error";
  } else if (reacherUnknown || hasSmtpError) {
    category = "unknown";
    reason = hasSmtpError ? "SMTP verification did not produce a definitive mailbox result" : "Reacher reported an unknown result";
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
