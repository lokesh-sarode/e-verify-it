import type { FastifyInstance } from "fastify";
import { env, isReacherConfigured, reacherBaseUrlSummary } from "@e-verify-it/backend";

export async function configRoutes(app: FastifyInstance) {
  app.get("/api/config", async () => ({
    maxUploadMb: env.MAX_UPLOAD_MB,
    uploadExtensions: ["csv", "xlsx"],
    reacherBaseUrlConfigured: isReacherConfigured(),
    reacherBaseUrl: reacherBaseUrlSummary()
  }));
}
