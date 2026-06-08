import type { BulkJobEmail, UploadRejectedRow, VerificationResult } from "@prisma/client";

type ExportableResult = BulkJobEmail | VerificationResult;

const headers = [
  "email",
  "category",
  "is_reachable",
  "syntax_status",
  "mx_status",
  "smtp_status",
  "smtp_result",
  "catch_all",
  "disposable",
  "role_account",
  "free_provider",
  "reason",
  "checked_at",
  "raw_json"
];

export function resultsToCsv(results: ExportableResult[]): string {
  const rows = results.map((result) => [
    result.email,
    result.category ?? "",
    serializeNullable(result.isReachable),
    result.syntaxStatus ?? "",
    result.mxStatus ?? "",
    result.smtpStatus ?? "",
    result.smtpResult ?? "",
    serializeNullable("catchAll" in result ? result.catchAll : null),
    serializeNullable("disposable" in result ? result.disposable : null),
    serializeNullable("roleAccount" in result ? result.roleAccount : null),
    serializeNullable("freeProvider" in result ? result.freeProvider : null),
    result.reason ?? "",
    "checkedAt" in result ? result.checkedAt?.toISOString() ?? "" : result.createdAt.toISOString(),
    result.rawJson ? JSON.stringify(result.rawJson) : ""
  ]);

  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function rejectedRowsToCsv(rows: UploadRejectedRow[]): string {
  const rejectedHeaders = ["row_number", "email", "reason"];
  const rejectedRows = rows.map((row) => [
    row.rowNumber,
    row.emailRaw ?? "",
    row.reason
  ]);

  return [rejectedHeaders, ...rejectedRows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function serializeNullable(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value ? "true" : "false";
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
