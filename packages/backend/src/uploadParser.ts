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

type ParsedUploadRow = {
  rowNumber: number;
  data: Record<string, unknown>;
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

  const emailKey = findEmailColumn(rows[0].data);
  if (!emailKey) {
    throw new Error("The uploaded file must include an emails column");
  }

  return normalizeRows(rows, emailKey);
}

function parseCsv(buffer: Buffer): ParsedUploadRow[] {
  const records = parse(buffer, {
    bom: true,
    columns: true,
    skip_empty_lines: false,
    relax_column_count: true,
    trim: false
  }) as Array<Record<string, unknown>>;

  return records.map((data, index) => ({
    rowNumber: index + 2,
    data
  }));
}

async function parseWorkbook(buffer: Buffer): Promise<ParsedUploadRow[]> {
  const workbook = await XlsxPopulate.fromDataAsync(await sanitizeWorkbookBuffer(buffer));
  const sheet = workbook.sheet(0);
  const usedRange = sheet?.usedRange();
  const values = usedRange?.value() ?? [];
  const rows = Array.isArray(values[0]) ? values as unknown[][] : [values as unknown[]];
  const headers = rows[0]?.map((cell) => String(cell ?? "").trim()) ?? [];
  const dataRows = trimTrailingBlankRows(rows.slice(1));

  return dataRows.map((row, index) => ({
    rowNumber: index + 2,
    data: Object.fromEntries(headers.map((header, headerIndex) => [header, row[headerIndex] ?? ""]))
  }));
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

function normalizeRows(rows: ParsedUploadRow[], emailKey: string): ParsedUpload {
  const seen = new Set<string>();
  const rejectedRows: UploadRejected[] = [];
  const uniqueEmails: Array<{ email: string; normalizedEmail: string }> = [];
  let originalRows = 0;
  let emptyRows = 0;
  let duplicateRows = 0;
  let syntaxInvalidRows = 0;

  for (const row of rows) {
    if (isRecordBlank(row.data)) continue;

    originalRows += 1;

    const rawValue = row.data[emailKey] === undefined || row.data[emailKey] === null ? "" : String(row.data[emailKey]);
    const normalizedEmail = normalizeEmail(rawValue);

    if (!normalizedEmail) {
      emptyRows += 1;
      rejectedRows.push({ rowNumber: row.rowNumber, emailRaw: rawValue, reason: "empty" });
      continue;
    }

    if (!isValidEmailSyntax(normalizedEmail)) {
      syntaxInvalidRows += 1;
      rejectedRows.push({ rowNumber: row.rowNumber, emailRaw: rawValue, reason: "invalid_syntax" });
      continue;
    }

    if (seen.has(normalizedEmail)) {
      duplicateRows += 1;
      rejectedRows.push({ rowNumber: row.rowNumber, emailRaw: rawValue, reason: "duplicate" });
      continue;
    }

    seen.add(normalizedEmail);
    uniqueEmails.push({ email: rawValue.trim(), normalizedEmail });
  }

  if (originalRows === 0) {
    throw new Error("The uploaded file does not contain any email rows");
  }

  return {
    originalRows,
    emptyRows,
    duplicateRows,
    syntaxInvalidRows,
    uniqueEmails,
    rejectedRows
  };
}

function trimTrailingBlankRows(rows: unknown[][]): unknown[][] {
  let lastContentIndex = rows.length - 1;

  while (lastContentIndex >= 0 && isArrayRowBlank(rows[lastContentIndex])) {
    lastContentIndex -= 1;
  }

  return lastContentIndex >= 0 ? rows.slice(0, lastContentIndex + 1) : [];
}

function isRecordBlank(row: Record<string, unknown>) {
  return Object.values(row).every(isBlankCell);
}

function isArrayRowBlank(row: unknown[] | undefined) {
  return !row || row.every(isBlankCell);
}

function isBlankCell(value: unknown) {
  return value === undefined || value === null || String(value).trim() === "";
}
