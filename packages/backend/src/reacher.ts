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

export class ReacherConfigurationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  retry?: boolean;
};

const temporaryStatuses = new Set([429, 502, 503, 504]);
const placeholderReacherHosts = new Set(["verify.example.com"]);

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
  if (typeof source === "string" && source.trim()) return source;

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

  async getBulkResultsPage(jobId: string, options: { limit: number; offset: number }): Promise<unknown> {
    return this.request(`/bulk/${encodeURIComponent(jobId)}/results`, {
      method: "GET",
      query: {
        limit: options.limit,
        offset: options.offset
      }
    });
  }

  private async request(path: string, options: RequestOptions): Promise<unknown> {
    assertReacherConfigured(this.baseUrl);

    const retry = options.retry ?? true;
    const maxAttempts = retry ? 4 : 1;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.REACHER_TIMEOUT_MS);
      const url = this.buildUrl(path, options.query);

      try {
        const response = await fetch(url, {
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

          throw new ReacherHttpError(response.status, body, reacherErrorMessage(response.status, body));
        }

        return body;
      } catch (error) {
        if (attempt < maxAttempts && isTemporaryNetworkError(error)) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }

        throw reacherNetworkError(url, error);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error("Reacher request failed after retries");
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(`${this.baseUrl}${path}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    return url.toString();
  }
}

export function isReacherConfigured(baseUrl = env.REACHER_BASE_URL): boolean {
  try {
    const url = new URL(baseUrl);
    return !placeholderReacherHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function reacherBaseUrlSummary(baseUrl = env.REACHER_BASE_URL): string | null {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function assertReacherConfigured(baseUrl: string) {
  if (!isReacherConfigured(baseUrl)) {
    throw new ReacherConfigurationError(
      "REACHER_BASE_URL is not configured. Set it to your Reacher API v1 URL, for example https://your-reacher-host/v1."
    );
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
  if (error instanceof ReacherConfigurationError) return false;
  if (error instanceof Error && error.name === "AbortError") return true;
  return error instanceof TypeError;
}

function reacherErrorMessage(status: number, body: unknown): string {
  const message = getString(body, ["message", "error", "detail", "error.message"]);
  return message ? `Reacher request failed with HTTP ${status}: ${message}` : `Reacher request failed with HTTP ${status}`;
}

function reacherNetworkError(url: string, error: unknown): Error {
  if (error instanceof ReacherHttpError || error instanceof ReacherConfigurationError) return error;

  const target = safeUrlForMessage(url);
  if (error instanceof Error && error.name === "AbortError") {
    return new Error(`Reacher request timed out after ${env.REACHER_TIMEOUT_MS} ms while calling ${target}`);
  }

  const detail = nestedErrorMessage(error);
  const suffix = detail ? `: ${detail}` : "";
  return new Error(
    `Could not reach Reacher at ${target}${suffix}. If Reacher is running on your host machine and this app is running in Docker, set REACHER_BASE_URL to http://host.docker.internal:<port>/v1 instead of localhost.`
  );
}

function safeUrlForMessage(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function nestedErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message && error.message !== "fetch failed") return error.message;

  const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined;
  if (cause instanceof Error && cause.message) return cause.message;
  if (cause && typeof cause === "object") {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }

  return error instanceof Error && error.message ? error.message : null;
}
