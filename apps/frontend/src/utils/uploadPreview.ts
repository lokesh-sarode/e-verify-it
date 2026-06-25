import JSZip from "jszip";

export type PreviewRecordStatus = "valid" | "duplicate" | "invalid";

export type PreviewRecord = {
  rowNumber: number;
  email: string;
  status: PreviewRecordStatus;
};

export type UploadPreview = {
  filename: string;
  fileSize: number;
  uploadedAt: string;
  totalEmailCount: number;
  duplicateCount: number;
  validFormatCount: number;
  invalidFormatCount: number;
  uniqueValidCount: number;
  previewRecords: PreviewRecord[];
  warning?: string;
};

type EmailRow = {
  rowNumber: number;
  email: string;
};

const emailHeaders = new Set(["email", "emails", "email_address", "email address"]);
const maxPreviewRows = 50;

export async function createUploadPreview(file: File): Promise<UploadPreview> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const rows =
    extension === "csv"
      ? parseCsvEmailRows(await file.text())
      : extension === "xlsx"
        ? await parseWorkbookEmailRows(await file.arrayBuffer())
        : null;

  if (!rows) {
    throw new Error("Only CSV and XLSX files can be previewed");
  }

  return buildPreview(file, rows);
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function buildPreview(file: File, rows: EmailRow[]): UploadPreview {
  const seen = new Set<string>();
  const previewRecords: PreviewRecord[] = [];
  let totalEmailCount = 0;
  let duplicateCount = 0;
  let validFormatCount = 0;
  let invalidFormatCount = 0;

  for (const row of rows) {
    const email = row.email.trim();
    if (!email) continue;

    totalEmailCount += 1;
    const normalizedEmail = email.toLowerCase();
    const isValid = isValidEmailSyntax(normalizedEmail);

    if (!isValid) {
      invalidFormatCount += 1;
      pushPreview(previewRecords, { rowNumber: row.rowNumber, email, status: "invalid" });
      continue;
    }

    validFormatCount += 1;

    if (seen.has(normalizedEmail)) {
      duplicateCount += 1;
      pushPreview(previewRecords, { rowNumber: row.rowNumber, email, status: "duplicate" });
      continue;
    }

    seen.add(normalizedEmail);
    pushPreview(previewRecords, { rowNumber: row.rowNumber, email, status: "valid" });
  }

  return {
    filename: file.name,
    fileSize: file.size,
    uploadedAt: new Date().toISOString(),
    totalEmailCount,
    duplicateCount,
    validFormatCount,
    invalidFormatCount,
    uniqueValidCount: seen.size,
    previewRecords
  };
}

function pushPreview(records: PreviewRecord[], record: PreviewRecord) {
  if (records.length < maxPreviewRows) records.push(record);
}

function isValidEmailSyntax(email: string) {
  if (email.includes("..")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseCsvEmailRows(text: string): EmailRow[] {
  const table = parseCsvTable(text.replace(/^\uFEFF/, ""));
  if (!table.length) return [];

  const headerIndex = findEmailColumnIndex(table[0]);
  if (headerIndex < 0) {
    throw new Error("The preview needs an email column");
  }

  return table.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    email: row[headerIndex] ?? ""
  }));
}

function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value);
  rows.push(row);
  return rows.filter((item) => item.some((cell) => cell.trim()));
}

async function parseWorkbookEmailRows(buffer: ArrayBuffer): Promise<EmailRow[]> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStrings = await readSharedStrings(zip);
  const sheetPath = await findFirstSheetPath(zip);
  const sheetXml = await zip.file(sheetPath)?.async("text");

  if (!sheetXml) {
    throw new Error("Could not read the first worksheet");
  }

  const table = parseWorksheetTable(sheetXml, sharedStrings);
  if (!table.length) return [];

  const headerIndex = findEmailColumnIndex(table[0]);
  if (headerIndex < 0) {
    throw new Error("The preview needs an email column");
  }

  return table.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    email: row[headerIndex] ?? ""
  }));
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const xml = await zip.file("xl/sharedStrings.xml")?.async("text");
  if (!xml) return [];

  const doc = parseXml(xml);
  return elementsByName(doc, "si").map((node) =>
    elementsByName(node, "t").map((textNode) => textNode.textContent ?? "").join("")
  );
}

async function findFirstSheetPath(zip: JSZip): Promise<string> {
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");

  if (!workbookXml || !relsXml) return "xl/worksheets/sheet1.xml";

  const workbook = parseXml(workbookXml);
  const firstSheet = elementsByName(workbook, "sheet")[0];
  const relationshipId = firstSheet?.getAttribute("r:id");

  if (!relationshipId) return "xl/worksheets/sheet1.xml";

  const rels = parseXml(relsXml);
  const relationship = elementsByName(rels, "Relationship").find((item) => item.getAttribute("Id") === relationshipId);
  const target = relationship?.getAttribute("Target");

  if (!target) return "xl/worksheets/sheet1.xml";
  if (target.startsWith("/")) return target.slice(1);
  return `xl/${target.replace(/^\.?\//, "")}`;
}

function parseWorksheetTable(xml: string, sharedStrings: string[]): string[][] {
  const doc = parseXml(xml);
  const rows = elementsByName(doc, "row");

  return rows.map((row) => {
    const cells = elementsByName(row, "c");
    const values: string[] = [];

    for (const cell of cells) {
      const ref = cell.getAttribute("r") ?? "";
      const columnIndex = columnIndexFromRef(ref);
      values[columnIndex] = cellValue(cell, sharedStrings);
    }

    return values;
  });
}

function cellValue(cell: Element, sharedStrings: string[]) {
  const type = cell.getAttribute("t");

  if (type === "inlineStr") {
    return elementsByName(cell, "t").map((node) => node.textContent ?? "").join("");
  }

  const rawValue = elementsByName(cell, "v")[0]?.textContent ?? "";
  if (type === "s") return sharedStrings[Number(rawValue)] ?? "";
  return rawValue;
}

function columnIndexFromRef(ref: string) {
  const letters = ref.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let value = 0;

  for (const letter of letters) {
    value = value * 26 + letter.charCodeAt(0) - 64;
  }

  return Math.max(0, value - 1);
}

function findEmailColumnIndex(headers: string[]) {
  return headers.findIndex((header) => emailHeaders.has(header.trim().toLowerCase()));
}

function parseXml(xml: string) {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function elementsByName(parent: ParentNode, name: string) {
  return Array.from(parent.querySelectorAll(name));
}
