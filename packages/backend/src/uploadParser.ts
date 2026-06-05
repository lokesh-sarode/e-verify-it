import { parse } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";
import { isValidEmailSyntax, normalizeEmail } from "./email";

export type UploadRejected = {
  rowNumber: number;
  emailRaw: string | null;
  reason: "empty" | "duplicate" | "invalid_syntax";
};

export type ParsedUpload = {
  originalRows: number;
  emptyRows: number;
  duplicateRows: number;
  syntaxInvalidRows: number;
  uniqueEmails: Array<{ email: string; normalizedEmail: string }>;
  rejectedRows: UploadRejected[];
};

const emailAliases = new Set([
  "email",
  "emails",
  "email_address",
  "email address"
]);

export async function parseUploadFile(buffer: Buffer, filename: string): Promise<ParsedUpload> {
  const extension = filename.split(".").pop()?.toLowerCase();
  const rows =
    extension === "csv"
      ? parseCsv(buffer)
      : extension === "xlsx"
        ? await parseWorkbook(buffer)
        : null;

  if (!rows) {
    throw new Error("Only CSV and XLSX files are supported");
  }

  if (!rows.length) {
    throw new Error("The uploaded file is empty");
  }

  const emailKey = findEmailColumn(rows[0]);
  if (!emailKey) {
    throw new Error("The uploaded file must include an emails column");
  }

  return normalizeRows(rows, emailKey);
}

function parseCsv(buffer: Buffer): Array<Record<string, unknown>> {
  return parse(buffer, {
    bom: true,
    columns: true,
    skip_empty_lines: false,
    relax_column_count: true,
    trim: false
  });
}

async function parseWorkbook(buffer: Buffer): Promise<Array<Record<string, unknown>>> {
  const rows = await readXlsxFile(buffer);
  const headers = rows[0]?.map((cell) => String(cell ?? "").trim()) ?? [];

  return rows.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))
  );
}

function findEmailColumn(row: Record<string, unknown>): string | null {
  const keys = Object.keys(row);
  return (
    keys.find((key) => {
      const normalized = key.trim().toLowerCase();
      return emailAliases.has(normalized);
    }) ?? null
  );
}

function normalizeRows(rows: Array<Record<string, unknown>>, emailKey: string): ParsedUpload {
  const seen = new Set<string>();
  const rejectedRows: UploadRejected[] = [];
  const uniqueEmails: Array<{ email: string; normalizedEmail: string }> = [];
  let emptyRows = 0;
  let duplicateRows = 0;
  let syntaxInvalidRows = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const rawValue = row[emailKey] === undefined || row[emailKey] === null ? "" : String(row[emailKey]);
    const normalizedEmail = normalizeEmail(rawValue);

    if (!normalizedEmail) {
      emptyRows += 1;
      rejectedRows.push({ rowNumber, emailRaw: rawValue, reason: "empty" });
      return;
    }

    if (!isValidEmailSyntax(normalizedEmail)) {
      syntaxInvalidRows += 1;
      rejectedRows.push({ rowNumber, emailRaw: rawValue, reason: "invalid_syntax" });
      return;
    }

    if (seen.has(normalizedEmail)) {
      duplicateRows += 1;
      rejectedRows.push({ rowNumber, emailRaw: rawValue, reason: "duplicate" });
      return;
    }

    seen.add(normalizedEmail);
    uniqueEmails.push({ email: rawValue.trim(), normalizedEmail });
  });

  return {
    originalRows: rows.length,
    emptyRows,
    duplicateRows,
    syntaxInvalidRows,
    uniqueEmails,
    rejectedRows
  };
}
