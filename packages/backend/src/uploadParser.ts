import { parse } from "csv-parse/sync";
import JSZip from "jszip";
import XlsxPopulate from "xlsx-populate";
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
  const workbook = await XlsxPopulate.fromDataAsync(await sanitizeWorkbookBuffer(buffer));
  const sheet = workbook.sheet(0);
  const usedRange = sheet?.usedRange();
  const values = usedRange?.value() ?? [];
  const rows = Array.isArray(values[0]) ? values as unknown[][] : [values as unknown[]];
  const headers = rows[0]?.map((cell) => String(cell ?? "").trim()) ?? [];

  return rows.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))
  );
}

async function sanitizeWorkbookBuffer(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const worksheetPaths = Object.keys(zip.files).filter((path) => /^xl\/worksheets\/.+\.xml$/i.test(path));
  let changed = false;

  for (const path of worksheetPaths) {
    const file = zip.file(path);
    if (!file) continue;

    const xml = await file.async("string");
    const sanitized = xml
      .replace(/<c([^>]*\st="inlineStr"[^>]*)>\s*<\/c>/g, (_match, attrs: string) => `<c${removeInlineStringType(attrs)}></c>`)
      .replace(/<c([^>]*\st="inlineStr"[^>]*)\/>/g, (_match, attrs: string) => `<c${removeInlineStringType(attrs)}/>`);

    if (sanitized !== xml) {
      zip.file(path, sanitized);
      changed = true;
    }
  }

  return changed ? Buffer.from(await zip.generateAsync({ type: "nodebuffer" })) : buffer;
}

function removeInlineStringType(attrs: string) {
  return attrs.replace(/\s+t="inlineStr"/, "");
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
