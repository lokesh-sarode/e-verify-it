import type { FastifyInstance } from "fastify";
import { env } from "@e-verify-it/backend";

export async function configRoutes(app: FastifyInstance) {
  app.get("/api/config", async () => ({
    maxUploadMb: env.MAX_UPLOAD_MB,
    uploadExtensions: ["csv", "xlsx"],
    reacherBaseUrlConfigured: Boolean(env.REACHER_BASE_URL)
  }));
}

