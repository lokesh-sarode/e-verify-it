import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import {
  createBulkJobFromUpload,
  env,
  parseUploadFile,
  prisma,
  resultsToCsv,
  sanitizeFilename
} from "@e-verify-it/backend";

const downloadKinds = new Set(["all", "valid", "invalid", "risky", "unknown", "smtp-result"]);

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

    const buffer = await file.toBuffer();
    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (buffer.byteLength > maxBytes) {
      reply.code(413).send({ message: `File exceeds ${env.MAX_UPLOAD_MB} MB` });
      return;
    }

    const parsed = await parseUploadFile(buffer, filename);
    const job = await createBulkJobFromUpload(filename, parsed, request.admin?.id);

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
      processed: job.processed,
      valid: job.validCount,
      invalid: job.invalidCount,
      risky: job.riskyCount,
      unknown: job.unknownCount,
      syntaxInvalid: job.syntaxInvalidRows,
      duplicatesRemoved: job.duplicateRows,
      progressPercentage: job.uniqueEmails ? Math.round((job.processed / job.uniqueEmails) * 100) : 100,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
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
