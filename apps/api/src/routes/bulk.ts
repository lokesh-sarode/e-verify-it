import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import {
  createBulkJobFromUpload,
  env,
  parseUploadFile,
  prisma,
  rejectedRowsToCsv,
  resultsToCsv,
  sanitizeFilename
} from "@e-verify-it/backend";
import { z } from "zod";

const downloadKinds = new Set(["all", "valid", "invalid", "risky", "unknown", "smtp-result", "duplicates"]);
const bulkStatuses = ["pending", "processing", "completed", "failed", "cancelled"] as const;
const categories = ["valid", "invalid", "risky", "unknown"] as const;
const allowedMimeTypes = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream"
]);

const ListBulkJobsQuerySchema = z.object({
  status: z.enum(bulkStatuses).optional(),
  take: z.coerce.number().int().min(1).max(100).default(50)
});

const ResultsQuerySchema = z.object({
  category: z.enum(categories).optional(),
  q: z.string().trim().max(320).optional(),
  take: z.coerce.number().int().min(1).max(500).default(100)
});

export async function bulkRoutes(app: FastifyInstance) {
  app.post("/api/bulk-jobs/upload", { preHandler: app.authenticate }, async (request, reply) => {
    const file = await request.file();

    if (!file) {
      reply.code(400).send({ message: "Upload a CSV or XLSX file" });
      return;
    }

    const filename = sanitizeFilename(file.filename);
    const extension = filename.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx"].includes(extension ?? "")) {
      reply.code(400).send({ message: "Only CSV and XLSX files are supported" });
      return;
    }

    if (file.mimetype && !allowedMimeTypes.has(file.mimetype)) {
      reply.code(400).send({ message: `Unsupported file type: ${file.mimetype}` });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (error) {
      const code = typeof error === "object" && error ? (error as { code?: string }).code : undefined;
      if (code === "FST_REQ_FILE_TOO_LARGE") {
        reply.code(413).send({ message: `File exceeds ${env.MAX_UPLOAD_MB} MB` });
        return;
      }

      throw error;
    }

    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (buffer.byteLength > maxBytes) {
      reply.code(413).send({ message: `File exceeds ${env.MAX_UPLOAD_MB} MB` });
      return;
    }

    let parsed;
    try {
      parsed = await parseUploadFile(buffer, filename);
    } catch (error) {
      reply.code(400).send({ message: error instanceof Error ? error.message : "Could not parse upload file" });
      return;
    }

    let job;
    try {
      job = await createBulkJobFromUpload(filename, parsed, request.admin?.id);
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
    const query = ListBulkJobsQuerySchema.parse(request.query);

    return prisma.bulkJob.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: { createdAt: "desc" },
      take: query.take
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
      processed: job.processed,
      valid: job.validCount,
      invalid: job.invalidCount,
      risky: job.riskyCount,
      unknown: job.unknownCount,
      syntaxInvalid: job.syntaxInvalidRows,
      duplicatesRemoved: job.duplicateRows,
      progressPercentage: progressPercentage(job.processed, job.uniqueEmails),
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
    const query = ResultsQuerySchema.parse(request.query);

    const job = await prisma.bulkJob.findUnique({ where: { id }, select: { id: true } });
    if (!job) {
      reply.code(404).send({ message: "Bulk job not found" });
      return;
    }

    return prisma.bulkJobEmail.findMany({
      where: {
        bulkJobId: id,
        ...(query.category ? { category: query.category } : {}),
        ...(query.q ? { normalizedEmail: { contains: query.q.toLowerCase() } } : {})
      },
      orderBy: { createdAt: "asc" },
      take: query.take
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

function progressPercentage(processed: number, total: number) {
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
}
