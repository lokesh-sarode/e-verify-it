import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import {
  classifyReacherResult,
  env,
  isValidEmailSyntax,
  normalizeEmail,
  prisma,
  ReacherClient
} from "@e-verify-it/backend";
import { z } from "zod";

const SingleVerifySchema = z.object({
  email: z.string().min(1)
});

export async function singleRoutes(app: FastifyInstance) {
  app.post("/api/verify/single", { preHandler: app.authenticate }, async (request, reply) => {
    const body = SingleVerifySchema.parse(request.body);
    const normalizedEmail = normalizeEmail(body.email);

    if (!isValidEmailSyntax(normalizedEmail)) {
      reply.code(400).send({ message: "Invalid email syntax" });
      return;
    }

    const cached = await findCachedSingleResult(normalizedEmail);
    if (cached) {
      reply.send({ result: cached, cached: true });
      return;
    }

    const raw = await new ReacherClient().checkEmail(normalizedEmail);
    const classified = classifyReacherResult(raw);

    const result = await prisma.verificationResult.create({
      data: {
        email: body.email.trim(),
        normalizedEmail,
        category: classified.category,
        isReachable: classified.isReachable,
        syntaxStatus: classified.syntaxStatus,
        mxStatus: classified.mxStatus,
        smtpStatus: classified.smtpStatus,
        smtpResult: classified.smtpResult,
        catchAll: classified.catchAll,
        disposable: classified.disposable,
        roleAccount: classified.roleAccount,
        freeProvider: classified.freeProvider,
        reason: classified.reason,
        rawJson: (classified.rawJson ?? {}) as Prisma.InputJsonValue,
        source: "single"
      }
    });

    await prisma.auditLog.create({
      data: {
        adminId: request.admin?.id,
        action: "single_verification",
        meta: { email: normalizedEmail, category: result.category }
      }
    });

    reply.send({ result, cached: false });
  });
}

async function findCachedSingleResult(normalizedEmail: string) {
  if (env.VERIFICATION_CACHE_DAYS <= 0) return null;

  const since = new Date(Date.now() - env.VERIFICATION_CACHE_DAYS * 24 * 60 * 60 * 1000);
  return prisma.verificationResult.findFirst({
    where: {
      normalizedEmail,
      createdAt: { gte: since }
    },
    orderBy: { createdAt: "desc" }
  });
}

