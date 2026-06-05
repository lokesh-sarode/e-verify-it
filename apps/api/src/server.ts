import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastify from "fastify";
import { env } from "@e-verify-it/backend";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { bulkRoutes } from "./routes/bulk";
import { singleRoutes } from "./routes/single";
import { authPlugin } from "./plugins/auth";

export async function buildServer() {
  const app = fastify({
    logger: env.NODE_ENV === "production"
  });

  await app.register(helmet);
  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin || origin === env.FRONTEND_URL) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed"), false);
    }
  });
  await app.register(cookie, {
    secret: env.COOKIE_SECRET
  });
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute"
  });
  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
      files: 1
    }
  });

  await app.register(authPlugin);
  await app.register(authRoutes);
  await app.register(singleRoutes);
  await app.register(bulkRoutes);
  await app.register(adminRoutes);

  app.get("/api/health", async () => ({
    ok: true,
    service: "e-verify-it-api"
  }));

  return app;
}

