import { env } from "./env";

export class ReacherHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message = `Reacher request failed with HTTP ${status}`
  ) {
    super(message);
  }
}

export class ReacherWorkerModeUnavailableError extends Error {
  constructor(message = "Reacher worker mode is unavailable") {
    super(message);
  }
}

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  retry?: boolean;
};

const temporaryStatuses = new Set([429, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== "object") return undefined;

  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function getString(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = readPath(source, path);
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }

  return null;
}

function includesWorkerModeMessage(body: unknown): boolean {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return /worker mode|enable worker|rabbitmq/i.test(text);
}

export class ReacherClient {
  private readonly baseUrl: string;

  constructor(baseUrl = env.REACHER_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async checkEmail(email: string): Promise<unknown> {
    return this.request("/check_email", {
      method: "POST",
      body: { to_email: email }
    });
  }

  async createBulkJob(emails: string[]): Promise<{ jobId: string; raw: unknown }> {
    try {
      const raw = await this.request("/bulk", {
        method: "POST",
        body: { input: emails },
        retry: false
      });

      const jobId = getString(raw, ["job_id", "id", "data.job_id", "data.id"]);
      if (!jobId) {
        throw new Error("Reacher bulk response did not include a job id");
      }

      return { jobId, raw };
    } catch (error) {
      if (
        error instanceof ReacherHttpError &&
        (error.status === 503 || includesWorkerModeMessage(error.body))
      ) {
        throw new ReacherWorkerModeUnavailableError();
      }

      throw error;
    }
  }

  async getBulkProgress(jobId: string): Promise<unknown> {
    return this.request(`/bulk/${encodeURIComponent(jobId)}`, { method: "GET" });
  }

  async getBulkResults(jobId: string): Promise<unknown> {
    return this.request(`/bulk/${encodeURIComponent(jobId)}/results`, { method: "GET" });
  }

  private async request(path: string, options: RequestOptions): Promise<unknown> {
    const retry = options.retry ?? true;
    const maxAttempts = retry ? 4 : 1;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.REACHER_TIMEOUT_MS);

      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: options.method ?? "GET",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(env.REACHER_API_KEY ? { Authorization: env.REACHER_API_KEY } : {})
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });

        const text = await response.text();
        const body = text ? safeJson(text) : null;

        if (!response.ok) {
          if (attempt < maxAttempts && temporaryStatuses.has(response.status)) {
            await sleep(500 * 2 ** (attempt - 1));
            continue;
          }

          throw new ReacherHttpError(response.status, body);
        }

        return body;
      } catch (error) {
        if (attempt < maxAttempts && isTemporaryNetworkError(error)) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error("Reacher request failed after retries");
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isTemporaryNetworkError(error: unknown): boolean {
  if (error instanceof ReacherHttpError) return temporaryStatuses.has(error.status);
  if (error instanceof Error && error.name === "AbortError") return true;
  return error instanceof TypeError;
}

