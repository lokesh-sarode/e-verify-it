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
let worker: Worker<BulkQueuePayload> | undefined;
let pollingTimer: NodeJS.Timeout | undefined;

void start().catch(async (error) => {
  console.error("Worker startup failed", error);
  await prisma.$disconnect();
  process.exit(1);
});

async function start() {
  await waitForDatabaseSchema();

  worker = new Worker<BulkQueuePayload>(
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

  pollingTimer = setInterval(() => {
    void pollActiveJobs();
  }, pollIntervalMs);

  void pollActiveJobs();
}

async function waitForDatabaseSchema() {
  let attempt = 0;

  while (true) {
    try {
      await prisma.bulkJob.findFirst({
        select: {
          id: true,
          reacherEmails: true
        }
      });
      return;
    } catch (error) {
      if (!isDatabaseSchemaNotReadyError(error)) throw error;

      attempt += 1;
      const suffix = attempt === 1 ? "" : ` (attempt ${attempt})`;
      console.warn(`Worker waiting for database migrations to finish${suffix}`);
      await sleep(5000);
    }
  }
}

async function pollActiveJobs() {
  if (isPolling) return;
  isPolling = true;

  try {
    await pollActiveReacherBulkJobs();
  } catch (error) {
    if (isDatabaseSchemaNotReadyError(error)) {
      console.warn("Bulk polling skipped because database migrations are not finished");
      return;
    }

    console.error("Bulk polling failed", error);
  } finally {
    isPolling = false;
  }
}

async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down worker`);
  if (pollingTimer) clearInterval(pollingTimer);
  await worker?.close();
  await prisma.$disconnect();
  process.exit(0);
}

function isDatabaseSchemaNotReadyError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;

  const code = String((error as { code?: unknown }).code);
  return code === "P2021" || code === "P2022";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
