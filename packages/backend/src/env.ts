import "dotenv/config";
import { z } from "zod";

const numberFromEnv = (fallback: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }, z.number().positive());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/email_verifier"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  ADMIN_PASSWORD: z.string().min(8).default("ChangeThisStrongPassword"),
  JWT_SECRET: z.string().min(24).default("change_this_secret_at_least_24_chars"),
  COOKIE_SECRET: z.string().min(24).default("change_this_cookie_secret_24"),
  REACHER_BASE_URL: z.string().url().default("https://verify.example.com/v1"),
  REACHER_API_KEY: z.string().optional().default(""),
  REACHER_BULK_POLL_INTERVAL_MS: numberFromEnv(4000),
  REACHER_BULK_RESULTS_PAGE_SIZE: numberFromEnv(500),
  REACHER_TIMEOUT_MS: numberFromEnv(60000),
  VERIFICATION_CACHE_DAYS: numberFromEnv(7),
  MAX_UPLOAD_MB: numberFromEnv(20),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  API_PORT: numberFromEnv(4000)
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
