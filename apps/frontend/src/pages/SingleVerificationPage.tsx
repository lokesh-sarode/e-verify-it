import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { api, apiErrorMessage } from "../api/client";
import { CategoryBadge } from "../components/StatusBadge";
import { ErrorBanner } from "../components/ErrorBanner";
import { RawJson } from "../components/RawJson";
import type { VerificationResult } from "../types";

export function SingleVerificationPage() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<{ result: VerificationResult; cached: boolean }>("/verify/single", { email });
      return response.data.result;
    },
    onSuccess(data) {
      setResult(data);
      setError(null);
    },
    onError(err) {
      setError(apiErrorMessage(err));
    }
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <form onSubmit={handleSubmit} className="app-panel p-5">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand-50 text-brand-700">
            <MailCheck size={21} />
          </div>
          <h2 className="text-base font-semibold text-zinc-950">Email check</h2>
        </div>
        {error ? <div className="mb-4"><ErrorBanner message={error} /></div> : null}
        <label className="block text-sm font-medium text-zinc-700" htmlFor="single-email">
          Email
        </label>
        <input
          id="single-email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          required
          className="input mt-2 h-11 w-full"
        />
        <button
          type="submit"
          disabled={mutation.isPending}
          className="btn btn-primary mt-4 h-11 w-full"
        >
          {mutation.isPending ? "Verifying" : "Verify"}
        </button>
      </form>

      <section className="app-panel p-5">
        {result ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-950">{result.email}</h2>
                <p className="mt-1 text-sm text-zinc-500">{result.reason}</p>
              </div>
              <CategoryBadge value={result.category} />
            </div>

            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["Reachable", String(result.isReachable ?? "-")],
                ["Syntax", result.syntaxStatus ?? "-"],
                ["MX", result.mxStatus ?? "-"],
                ["SMTP", result.smtpStatus ?? "-"],
                ["SMTP result", result.smtpResult ?? "-"],
                ["Catch-all", String(result.catchAll ?? "-")],
                ["Disposable", String(result.disposable ?? "-")],
                ["Role account", String(result.roleAccount ?? "-")],
                ["Free provider", String(result.freeProvider ?? "-")]
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase tracking-normal text-zinc-500">{label}</dt>
                  <dd className="mt-1 break-words text-sm font-medium text-zinc-900">{value}</dd>
                </div>
              ))}
            </dl>

            <RawJson value={result.rawJson} />
          </div>
        ) : (
          <div className="flex min-h-64 items-center justify-center text-sm text-zinc-500">
            Verification result
          </div>
        )}
      </section>
    </div>
  );
}
