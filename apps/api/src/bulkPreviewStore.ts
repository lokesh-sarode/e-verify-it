import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PreparedBulkUpload } from "@e-verify-it/backend";

export type StoredBulkPreview = {
  id: string;
  filename: string;
  createdAt: string;
  prepared: PreparedBulkUpload;
};

const previewDir = join(tmpdir(), "e-verify-it-bulk-previews");
const previewTtlMs = 60 * 60 * 1000;

export async function saveBulkPreview(filename: string, prepared: PreparedBulkUpload) {
  await cleanupExpiredPreviews();
  await mkdir(previewDir, { recursive: true });

  const id = randomUUID();
  const preview: StoredBulkPreview = {
    id,
    filename,
    createdAt: new Date().toISOString(),
    prepared
  };

  await writeFile(previewPath(id), JSON.stringify(preview), "utf8");
  return preview;
}

export async function readBulkPreview(id: string) {
  if (!isPreviewId(id)) return null;

  try {
    const preview = JSON.parse(await readFile(previewPath(id), "utf8")) as StoredBulkPreview;
    if (Date.now() - new Date(preview.createdAt).getTime() > previewTtlMs) {
      await deleteBulkPreview(id);
      return null;
    }

    return preview;
  } catch {
    return null;
  }
}

export async function deleteBulkPreview(id: string) {
  if (!isPreviewId(id)) return;
  await rm(previewPath(id), { force: true });
}

export function bulkPreviewSummary(preview: StoredBulkPreview) {
  const { prepared } = preview;

  return {
    id: preview.id,
    filename: preview.filename,
    createdAt: preview.createdAt,
    originalRows: prepared.originalRows,
    emptyRows: prepared.emptyRows,
    duplicateRows: prepared.duplicateRows,
    syntaxInvalidRows: prepared.syntaxInvalidRows,
    uniqueEmails: prepared.uniqueEmails.length,
    prefilteredEmails: prepared.prefilteredEmails.length,
    reacherEmails: prepared.reacherEmails.length,
    noMxRows: prepared.noMxRows,
    disposableRows: prepared.disposableRows,
    mxLookupFailedRows: prepared.mxLookupFailedRows,
    rejectedRows: prepared.rejectedRows.slice(0, 100).map((row) => ({
      rowNumber: row.rowNumber,
      emailRaw: row.emailRaw,
      reason: row.reason
    }))
  };
}

async function cleanupExpiredPreviews() {
  try {
    const files = await readdir(previewDir);
    await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          const path = join(previewDir, file);
          try {
            const preview = JSON.parse(await readFile(path, "utf8")) as StoredBulkPreview;
            if (Date.now() - new Date(preview.createdAt).getTime() > previewTtlMs) {
              await rm(path, { force: true });
            }
          } catch {
            await rm(path, { force: true });
          }
        })
    );
  } catch {
    return;
  }
}

function previewPath(id: string) {
  return join(previewDir, `${id}.json`);
}

function isPreviewId(id: string) {
  return /^[0-9a-f-]{36}$/i.test(id);
}
