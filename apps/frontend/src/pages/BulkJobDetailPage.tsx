import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { ProgressBar } from "../components/ProgressBar";
import { CategoryBadge, StatusBadge } from "../components/StatusBadge";
import type { BulkJob, BulkProgress, Category, VerificationResult } from "../types";

const categories: Array<"all" | Category> = ["all", "valid", "invalid", "risky", "unknown"];
const downloads = ["all", "valid", "invalid", "risky", "unknown", "smtp-result"];

export function BulkJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [category, setCategory] = useState<"all" | Category>("all");
  const [query, setQuery] = useState("");

  const jobQuery = useQuery({
    queryKey: ["bulk-job", id],
    queryFn: async () => (await api.get<BulkJob>(`/bulk-jobs/${id}`)).data,
    enabled: Boolean(id)
  });

  const progressQuery = useQuery({
    queryKey: ["bulk-progress", id],
    queryFn: async () => (await api.get<BulkProgress>(`/bulk-jobs/${id}/progress`)).data,
    enabled: Boolean(id),
    refetchInterval: (queryState) => {
      const status = queryState.state.data?.status;
      return status === "completed" || status === "failed" || status === "cancelled" ? false : 4000;
    }
  });

  const resultsQuery = useQuery({
    queryKey: ["bulk-results", id, category, query],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (query) params.set("q", query);
      const response = await api.get<VerificationResult[]>(`/bulk-jobs/${id}/results?${params.toString()}`);
      return response.data;
    },
    enabled: Boolean(id),
    refetchInterval: 6000
  });

  const progress = progressQuery.data;
  const job = jobQuery.data;
  const canDownload = progress?.status === "completed";

  const counters = useMemo(() => {
    if (!progress) return [];
    return [
      ["Total rows", progress.totalRows],
      ["Unique", progress.uniqueEmails],
      ["Processed", progress.processed],
      ["Valid", progress.valid],
      ["Invalid", progress.invalid],
      ["Risky", progress.risky],
      ["Unknown", progress.unknown],
      ["Syntax invalid", progress.syntaxInvalid],
      ["Duplicates", progress.duplicatesRemoved],
      ["Elapsed", formatDuration(progress.elapsedSeconds)],
      ["ETA", formatDuration(progress.estimatedRemainingSeconds)],
      ["Rate", `${progress.recordsPerSecond}/s`]
    ];
  }, [progress]);

  if (jobQuery.isLoading || progressQuery.isLoading) {
    return <div className="text-sm text-zinc-500">Loading job</div>;
  }

  if (!job || !progress) {
    return <ErrorBanner message="Bulk job not found" />;
  }

  return (
    <div className="space-y-6">
      {progress.errorMessage ? <ErrorBanner message={progress.errorMessage} /> : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">{job.filename}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {progress.mode ?? "pending mode"}{progress.reacherJobId ? ` · Reacher job ${progress.reacherJobId}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void progressQuery.refetch();
                void resultsQuery.refetch();
              }}
              title="Refresh"
              className="focus-ring flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
            >
              <RefreshCw size={18} />
            </button>
            <StatusBadge value={progress.status} />
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium text-zinc-700">Progress</span>
            <span className="text-zinc-500">{progress.progressPercentage}%</span>
          </div>
          <ProgressBar value={progress.progressPercentage} />
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {counters.map(([label, value]) => (
            <div key={label} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <dt className="text-xs font-medium uppercase tracking-normal text-zinc-500">{label}</dt>
              <dd className="mt-1 text-lg font-semibold text-zinc-950">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white shadow-soft">
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                className={[
                  "focus-ring h-9 rounded-md border px-3 text-sm font-medium",
                  category === item
                    ? "border-teal-600 bg-teal-600 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
                ].join(" ")}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="focus-ring h-9 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-sm sm:w-72"
                placeholder="Search email"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-zinc-200 p-4">
          {downloads.map((kind) => (
            <a
              key={kind}
              href={`/api/bulk-jobs/${id}/download/${kind}`}
              className={[
                "focus-ring inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium",
                canDownload
                  ? "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
                  : "pointer-events-none border-zinc-200 bg-zinc-100 text-zinc-400"
              ].join(" ")}
            >
              <Download size={16} />
              {kind}
            </a>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-normal text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Reachable</th>
                <th className="px-4 py-3 font-medium">Syntax</th>
                <th className="px-4 py-3 font-medium">MX</th>
                <th className="px-4 py-3 font-medium">SMTP</th>
                <th className="px-4 py-3 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {(resultsQuery.data ?? []).map((result) => (
                <tr key={result.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium text-zinc-950">{result.email}</td>
                  <td className="px-4 py-3"><CategoryBadge value={result.category} /></td>
                  <td className="px-4 py-3">{String(result.isReachable ?? "-")}</td>
                  <td className="px-4 py-3">{result.syntaxStatus ?? "-"}</td>
                  <td className="px-4 py-3">{result.mxStatus ?? "-"}</td>
                  <td className="px-4 py-3">{result.smtpStatus ?? "-"}</td>
                  <td className="max-w-md px-4 py-3 text-zinc-600">{result.reason ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!resultsQuery.data?.length ? (
            <div className="p-6 text-center text-sm text-zinc-500">No results</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function formatDuration(totalSeconds: number) {
  if (!totalSeconds) return "0s";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
