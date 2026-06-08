import { Queue, type ConnectionOptions } from "bullmq";
import { env } from "./env";

export const bulkQueueName = "bulk-verification";
export type BulkQueuePayload = { bulkJobId: string };

let queue: ReturnType<typeof createBulkQueue> | null = null;

export function createRedisConnection(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  const db = url.pathname ? Number(url.pathname.replace("/", "")) : 0;

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isFinite(db) ? db : 0,
    maxRetriesPerRequest: null
  };
}

function createBulkQueue() {
  return new Queue<BulkQueuePayload>(bulkQueueName, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 60 * 60 * 24 * 7 },
      removeOnFail: { age: 60 * 60 * 24 * 14 }
    }
  });
}

export function getBulkQueue() {
  if (!queue) {
    queue = createBulkQueue();
  }

  return queue;
}

export async function enqueueBulkJob(bulkJobId: string) {
  await getBulkQueue().add(`bulk-${bulkJobId}`, { bulkJobId }, { jobId: bulkJobId });
}
