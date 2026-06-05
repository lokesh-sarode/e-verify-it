import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env, prisma } from "@e-verify-it/backend";

type AdminSession = {
  id: string;
  email: string;
};

declare module "fastify" {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }

  interface FastifyRequest {
    admin?: AdminSession;
  }
}

export function signAdminToken(admin: AdminSession): string {
  return jwt.sign({ sub: admin.id, email: admin.email }, env.JWT_SECRET, {
    expiresIn: "8h"
  });
}

export const authPlugin = fp(async (app) => {
  app.decorate("authenticate", async (request, reply) => {
    const header = request.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    const token = request.cookies.auth_token ?? bearer;

    if (!token) {
      reply.code(401).send({ message: "Authentication required" });
      return;
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      const adminId = typeof decoded.sub === "string" ? decoded.sub : null;

      if (!adminId) {
        reply.code(401).send({ message: "Invalid session" });
        return;
      }

      const admin = await prisma.adminUser.findUnique({
        where: { id: adminId },
        select: { id: true, email: true }
      });

      if (!admin) {
        reply.code(401).send({ message: "Invalid session" });
        return;
      }

      request.admin = admin;
    } catch {
      reply.code(401).send({ message: "Invalid session" });
    }
  });
});

