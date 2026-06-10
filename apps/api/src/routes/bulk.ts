import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import {
  createBulkJobFromUpload,
  env,
  parseUploadFile,
  prepareBulkUpload,
  prisma,
  rejectedRowsToCsv,
  resultsToCsv,
  sanitizeFilename
} from "@e-verify-it/backend";
import { z } from "zod";
import {
  bulkPreviewSummary,
  deleteBulkPreview,
  readBulkPreview,
  saveBulkPreview
} from "../bulkPreviewStore";

const downloadKinds = new Set(["all", "valid", "invalid", "risky", "unknown", "smtp-result", "duplicates"]);
const allowedMimeTypes = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream"
]);

const CreateFromPreviewSchema = z.object({
  previewId: z.string().uuid()
});

class UploadRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export async function bulkRoutes(app: FastifyInstance) {
  app.post("/api/bulk-jobs/preview", { preHandler: app.authenticate }, async (request, reply) => {
    const file = await request.file();

    if (!file) {
      reply.code(400).send({ message: "Upload a CSV or XLSX file" });
      return;
    }

    try {
      const { filename, prepared } = await prepareUpload(file);
      const preview = await saveBulkPreview(filename, prepared);
      reply.code(201).send({ preview: bulkPreviewSummary(preview) });
    } catch (error) {
      if (error instanceof UploadRequestError) {
        reply.code(error.statusCode).send({ message: error.message });
        return;
      }

      throw error;
    }
  });

  app.post("/api/bulk-jobs/from-preview", { preHandler: app.authenticate }, async (request, reply) => {
    const body = CreateFromPreviewSchema.parse(request.body);
    const preview = await readBulkPreview(body.previewId);

    if (!preview) {
      reply.code(404).send({ message: "Bulk preview expired or was not found. Upload the file again." });
      return;
    }

    let job;
    try {
      job = await createBulkJobFromUpload(preview.filename, preview.prepared, request.admin?.id);
      await deleteBulkPreview(preview.id);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Redis/BullMQ")) {
        reply.code(503).send({ message: error.message });
        return;
      }

      throw error;
    }

    reply.code(201).send({ job });
  });

  app.post("/api/bulk-jobs/upload", { preHandler: app.authenticate }, async (request, reply) => {
    const file = await request.file();

    if (!file) {
      reply.code(400).send({ message: "Upload a CSV or XLSX file" });
      return;
    }

    let filename;
    let prepared;
    try {
      ({ filename, prepared } = await prepareUpload(file));
    } catch (error) {
      if (error instanceof UploadRequestError) {
        reply.code(error.statusCode).send({ message: error.message });
        return;
      }

      throw error;
    }

    let job;
    try {
      job = await createBulkJobFromUpload(filename, prepared, request.admin?.id);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Redis/BullMQ")) {
        reply.code(503).send({ message: error.message });
        return;
      }

      throw error;
    }

    reply.code(201).send({ job });
  });

  app.get("/api/bulk-jobs", { preHandler: app.authenticate }, async (request) => {
    const query = request.query as { status?: string; take?: string };
    const take = Math.min(Number(query.take ?? 50), 100);

    return prisma.bulkJob.findMany({
      where: query.status ? { status: query.status as Prisma.EnumBulkJobStatusFilter["equals"] } : undefined,
      orderBy: { createdAt: "desc" },
      take
    });
  });

  app.get("/api/bulk-jobs/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await prisma.bulkJob.findUnique({
      where: { id },
      include: {
        rejectedRows: {
          orderBy: { rowNumber: "asc" },
          take: 100
        }
      }
    });

    if (!job) {
      reply.code(404).send({ message: "Bulk job not found" });
      return;
    }

    return job;
  });

  app.get("/api/bulk-jobs/:id/progress", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await prisma.bulkJob.findUnique({ where: { id } });

    if (!job) {
      reply.code(404).send({ message: "Bulk job not found" });
      return;
    }

    return {
      jobId: job.id,
      status: job.status,
      totalRows: job.originalRows,
      uniqueEmails: job.uniqueEmails,
      reacherEmails: job.reacherEmails,
      prefilteredEmails: job.prefilteredEmails,
      processed: job.processed,
      valid: job.validCount,
      invalid: job.invalidCount,
      risky: job.riskyCount,
      unknown: job.unknownCount,
      syntaxInvalid: job.syntaxInvalidRows,
      duplicatesRemoved: job.duplicateRows,
      noMxRows: job.noMxRows,
      disposableRows: job.disposableRows,
      mxLookupFailedRows: job.mxLookupFailedRows,
      progressPercentage: job.uniqueEmails ? Math.round((job.processed / job.uniqueEmails) * 100) : 100,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      elapsedSeconds: elapsedSeconds(job.startedAt, job.completedAt),
      estimatedRemainingSeconds: estimatedRemainingSeconds(job.startedAt, job.completedAt, job.processed, job.uniqueEmails),
      recordsPerSecond: recordsPerSecond(job.startedAt, job.completedAt, job.processed),
      mode: job.mode,
      reacherJobId: job.reacherJobId,
      errorMessage: job.errorMessage
    };
  });

  app.get("/api/bulk-jobs/:id/results", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { category?: string; q?: string; take?: string };
    const take = Math.min(Number(query.take ?? 100), 500);

    const job = await prisma.bulkJob.findUnique({ where: { id }, select: { id: true } });
    if (!job) {
      reply.code(404).send({ message: "Bulk job not found" });
      return;
    }

    return prisma.bulkJobEmail.findMany({
      where: {
        bulkJobId: id,
        ...(query.category ? { category: query.category as Prisma.EnumVerificationCategoryNullableFilter["equals"] } : {}),
        ...(query.q ? { normalizedEmail: { contains: query.q.toLowerCase() } } : {})
      },
      orderBy: { createdAt: "asc" },
      take
    });
  });

  app.get("/api/bulk-jobs/:id/download/:kind", { preHandler: app.authenticate }, async (request, reply) => {
    const { id, kind } = request.params as { id: string; kind: string };
    if (!downloadKinds.has(kind)) {
      reply.code(404).send({ message: "Download type not found" });
      return;
    }

    const job = await prisma.bulkJob.findUnique({ where: { id } });
    if (!job) {
      reply.code(404).send({ message: "Bulk job not found" });
      return;
    }

    if (kind === "duplicates") {
      const rows = await prisma.uploadRejectedRow.findMany({
        where: {
          bulkJobId: id,
          reason: "duplicate"
        },
        orderBy: { rowNumber: "asc" }
      });

      await prisma.auditLog.create({
        data: {
          adminId: request.admin?.id,
          action: "download",
          meta: { bulkJobId: id, kind, rowCount: rows.length }
        }
      });

      reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${job.filename}-duplicates.csv"`)
        .send(rejectedRowsToCsv(rows));
      return;
    }

    const where: Prisma.BulkJobEmailWhereInput = {
      bulkJobId: id,
      status: "completed"
    };

    if (["valid", "invalid", "risky", "unknown"].includes(kind)) {
      where.category = kind as Prisma.EnumVerificationCategoryNullableFilter["equals"];
    }

    if (kind === "smtp-result") {
      where.smtpResult = { not: null };
    }

    const rows = await prisma.bulkJobEmail.findMany({
      where,
      orderBy: { checkedAt: "asc" }
    });

    await prisma.auditLog.create({
      data: {
        adminId: request.admin?.id,
        action: "download",
        meta: { bulkJobId: id, kind, rowCount: rows.length }
      }
    });

    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${job.filename}-${kind}.csv"`)
      .send(resultsToCsv(rows));
  });
}

function elapsedSeconds(startedAt: Date | null, completedAt: Date | null) {
  if (!startedAt) return 0;
  const end = completedAt ?? new Date();
  return Math.max(0, Math.round((end.getTime() - startedAt.getTime()) / 1000));
}

function recordsPerSecond(startedAt: Date | null, completedAt: Date | null, processed: number) {
  const elapsed = elapsedSeconds(startedAt, completedAt);
  return elapsed > 0 ? Number((processed / elapsed).toFixed(2)) : 0;
}

function estimatedRemainingSeconds(startedAt: Date | null, completedAt: Date | null, processed: number, total: number) {
  if (!startedAt || completedAt || processed <= 0 || total <= processed) return 0;
  const rate = recordsPerSecond(startedAt, null, processed);
  return rate > 0 ? Math.max(0, Math.round((total - processed) / rate)) : 0;
}

type UploadedFile = {
  filename: string;
  mimetype: string;
  toBuffer(): Promise<Buffer>;
};

async function prepareUpload(file: UploadedFile) {
  const filename = sanitizeFilename(file.filename);
  const extension = filename.split(".").pop()?.toLowerCase();
  if (!["csv", "xlsx"].includes(extension ?? "")) {
    throw new UploadRequestError(400, "Only CSV and XLSX files are supported");
  }

  if (file.mimetype && !allowedMimeTypes.has(file.mimetype)) {
    throw new UploadRequestError(400, `Unsupported file type: ${file.mimetype}`);
  }

  let buffer: Buffer;
  try {
    buffer = await file.toBuffer();
  } catch (error) {
    const code = typeof error === "object" && error ? (error as { code?: string }).code : undefined;
    if (code === "FST_REQ_FILE_TOO_LARGE") {
      throw new UploadRequestError(413, `File exceeds ${env.MAX_UPLOAD_MB} MB`);
    }

    throw error;
  }

  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (buffer.byteLength > maxBytes) {
    throw new UploadRequestError(413, `File exceeds ${env.MAX_UPLOAD_MB} MB`);
  }

  try {
    const parsed = await parseUploadFile(buffer, filename);
    const prepared = await prepareBulkUpload(parsed);
    return { filename, prepared };
  } catch (error) {
    throw new UploadRequestError(400, error instanceof Error ? error.message : "Could not parse upload file");
  }
}
