import type { VerificationResult } from "@prisma/client";
import { env } from "./env";
import { prisma } from "./prisma";

const cacheLookupBatchSize = 1000;

export async function findCachedVerificationResult(normalizedEmail: string) {
  if (env.VERIFICATION_CACHE_DAYS <= 0) return null;

  return prisma.verificationResult.findFirst({
    where: {
      normalizedEmail,
      createdAt: { gte: cacheSinceDate() }
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function findCachedVerificationResults(normalizedEmails: string[]) {
  const cached = new Map<string, VerificationResult>();
  if (env.VERIFICATION_CACHE_DAYS <= 0) return cached;

  const uniqueEmails = [...new Set(normalizedEmails)];

  for (const batch of chunks(uniqueEmails, cacheLookupBatchSize)) {
    const rows = await prisma.verificationResult.findMany({
      where: {
        normalizedEmail: { in: batch },
        createdAt: { gte: cacheSinceDate() }
      },
      orderBy: { createdAt: "desc" }
    });

    for (const row of rows) {
      if (!cached.has(row.normalizedEmail)) cached.set(row.normalizedEmail, row);
    }
  }

  return cached;
}

function cacheSinceDate() {
  return new Date(Date.now() - env.VERIFICATION_CACHE_DAYS * 24 * 60 * 60 * 1000);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}
