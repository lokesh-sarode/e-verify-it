import { Worker } from "bullmq";
import {
  bulkQueueName,
  createRedisConnection,
  pollActiveReacherBulkJobs,
  prisma,
  submitBulkJobToReacher,
  type BulkQueuePayload
} from "@e-verify-it/backend";

const connection = createRedisConnection();
const pollIntervalMs = 30000;
let isPolling = false;

const worker = new Worker<BulkQueuePayload>(
  bulkQueueName,
  async (job) => {
    await submitBulkJobToReacher(job.data.bulkJobId);
  },
  {
    connection,
    concurrency: 1
  }
);

worker.on("ready", () => {
  console.log(`Bulk submit worker ready; polling active Reacher jobs every ${pollIntervalMs} ms`);
});

worker.on("failed", (job, error) => {
  console.error(`Bulk job ${job?.data.bulkJobId ?? "unknown"} failed`, error);
});

const pollingTimer = setInterval(() => {
  void pollActiveJobs();
}, pollIntervalMs);

void pollActiveJobs();

async function pollActiveJobs() {
  if (isPolling) return;
  isPolling = true;

  try {
    await pollActiveReacherBulkJobs();
  } catch (error) {
    console.error("Bulk polling failed", error);
  } finally {
    isPolling = false;
  }
}

async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down worker`);
  clearInterval(pollingTimer);
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
