import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import {
  classifyReacherResult,
  findCachedVerificationResult,
  isValidEmailSyntax,
  normalizeEmail,
  prefilterEmail,
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

    const prefiltered = await prefilterEmail(normalizedEmail);
    if (prefiltered) {
      const result = await prisma.verificationResult.create({
        data: {
          email: body.email.trim(),
          normalizedEmail,
          category: prefiltered.category,
          isReachable: prefiltered.isReachable,
          syntaxStatus: prefiltered.syntaxStatus,
          mxStatus: prefiltered.mxStatus,
          smtpStatus: prefiltered.smtpStatus,
          smtpResult: prefiltered.smtpResult,
          catchAll: prefiltered.catchAll,
          disposable: prefiltered.disposable,
          roleAccount: prefiltered.roleAccount,
          freeProvider: prefiltered.freeProvider,
          reason: prefiltered.reason,
          rawJson: (prefiltered.rawJson ?? {}) as Prisma.InputJsonValue,
          source: "single"
        }
      });

      await prisma.auditLog.create({
        data: {
          adminId: request.admin?.id,
          action: "single_verification",
          meta: { email: normalizedEmail, category: result.category, source: "pre_filter" }
        }
      });

      reply.send({ result, cached: false });
      return;
    }

    let raw: unknown;
    try {
      raw = await new ReacherClient().checkEmail(normalizedEmail);
    } catch (error) {
      reply.code(502).send({
        message: error instanceof Error ? error.message : "Reacher single email verification failed"
      });
      return;
    }
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
  return findCachedVerificationResult(normalizedEmail);
}
