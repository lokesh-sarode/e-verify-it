import type { FastifyInstance } from "fastify";
import { prisma } from "@e-verify-it/backend";

export async function adminRoutes(app: FastifyInstance) {
  app.get("/api/admin/stats", { preHandler: app.authenticate }, async () => {
    const [jobs, aggregates, latestJobs] = await Promise.all([
      prisma.bulkJob.count(),
      prisma.bulkJob.aggregate({
        _sum: {
          originalRows: true,
          uniqueEmails: true,
          validCount: true,
          invalidCount: true,
          riskyCount: true,
          unknownCount: true
        }
      }),
      prisma.bulkJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 6
      })
    ]);

    return {
      totalJobs: jobs,
      totalUploadedEmails: aggregates._sum.originalRows ?? 0,
      uniqueEmailsVerified: aggregates._sum.uniqueEmails ?? 0,
      validCount: aggregates._sum.validCount ?? 0,
      invalidCount: aggregates._sum.invalidCount ?? 0,
      riskyCount: aggregates._sum.riskyCount ?? 0,
      unknownCount: aggregates._sum.unknownCount ?? 0,
      latestJobs
    };
  });
}

