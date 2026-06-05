import type { FastifyInstance } from "fastify";
import { env, prisma, verifyPassword } from "@e-verify-it/backend";
import { z } from "zod";
import { signAdminToken } from "../plugins/auth";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "1 minute"
      }
    }
  }, async (request, reply) => {
    const body = LoginSchema.parse(request.body);
    const admin = await prisma.adminUser.findUnique({
      where: { email: body.email.toLowerCase() }
    });

    if (!admin || !(await verifyPassword(body.password, admin.passwordHash))) {
      reply.code(401).send({ message: "Invalid email or password" });
      return;
    }

    const token = signAdminToken({ id: admin.id, email: admin.email });

    reply.setCookie("auth_token", token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60
    });

    await prisma.auditLog.create({
      data: {
        adminId: admin.id,
        action: "login",
        meta: { email: admin.email }
      }
    });

    reply.send({ admin: { id: admin.id, email: admin.email } });
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie("auth_token", { path: "/" });
    reply.send({ ok: true });
  });

  app.get("/api/auth/me", { preHandler: app.authenticate }, async (request) => ({
    admin: request.admin
  }));
}

