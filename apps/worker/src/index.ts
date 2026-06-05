import { Worker } from "bullmq";
import {
  bulkQueueName,
  createRedisConnection,
  env,
  prisma,
  processBulkJob,
  type BulkQueuePayload
} from "@e-verify-it/backend";

const connection = createRedisConnection();

const worker = new Worker<BulkQueuePayload>(
  bulkQueueName,
  async (job) => {
    await processBulkJob(job.data.bulkJobId);
  },
  {
    connection,
    concurrency: 1
  }
);

worker.on("ready", () => {
  console.log(`Bulk worker ready with local verification concurrency ${env.BULK_CONCURRENCY}`);
});

worker.on("failed", (job, error) => {
  console.error(`Bulk job ${job?.data.bulkJobId ?? "unknown"} failed`, error);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down worker`);
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
