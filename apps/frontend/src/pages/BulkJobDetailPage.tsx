import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, apiUrl } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { PaginationControls } from "../components/PaginationControls";
import { ProgressBar } from "../components/ProgressBar";
import { CategoryBadge, StatusBadge } from "../components/StatusBadge";
import type { BulkJob, BulkProgress, Category, VerificationResult } from "../types";

type ResultFilter = "all" | Category | "smtp_verified";

const filters: Array<{ value: ResultFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "valid", label: "Valid" },
  { value: "invalid", label: "Invalid" },
  { value: "risky", label: "Risky" },
  { value: "unknown", label: "Unknown" },
  { value: "smtp_verified", label: "SMTP Verified" }
];
const downloads = ["all", "valid", "invalid", "risky", "unknown", "smtp-result", "duplicates"];

export function BulkJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

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
    queryKey: ["bulk-results", id, resultFilter, query],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (isCategoryFilter(resultFilter)) params.set("category", resultFilter);
      if (query) params.set("q", query);
      params.set("take", "500");
      const response = await api.get<VerificationResult[]>(`/bulk-jobs/${id}/results?${params.toString()}`);
      return response.data;
    },
    enabled: Boolean(id),
    refetchInterval: () => {
      const status = progressQuery.data?.status;
      return status === "completed" || status === "failed" || status === "cancelled" ? false : 6000;
    }
  });

  const progress = progressQuery.data;
  const job = jobQuery.data;
  const canDownload = (progress?.downloadableResults ?? 0) > 0;
  const visibleResults = useMemo(() => {
    const results = resultsQuery.data ?? [];
    if (resultFilter !== "smtp_verified") return results;
    return results.filter((result) => String(result.smtpStatus).toLowerCase() === "true");
  }, [resultFilter, resultsQuery.data]);

  const pagedResults = useMemo(() => {
    const safePage = Math.min(page, Math.max(1, Math.ceil(visibleResults.length / pageSize)));
    const start = (safePage - 1) * pageSize;
    return visibleResults.slice(start, start + pageSize);
  }, [page, pageSize, visibleResults]);

  const counters = useMemo(() => {
    if (!progress) return [];
    return [
      ["Total rows", progress.totalRows],
      ["Unique", progress.uniqueEmails],
      ["Processed", progress.processed],
      ["Batch size", progress.batchSize],
      ["Completed batches", `${progress.completedBatches}/${progress.totalBatches}`],
      ["Download rows", progress.downloadableResults],
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
    return <div className="app-panel p-6 text-sm text-zinc-500">Loading job</div>;
  }

  if (!job || !progress) {
    return <ErrorBanner message="Bulk job not found" />;
  }

  return (
    <div className="space-y-6">
      {progress.errorMessage ? <ErrorBanner message={progress.errorMessage} /> : null}

      <section className="app-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">{job.filename}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {progress.mode ?? "pending mode"}{progress.reacherJobId ? ` - Reacher job ${progress.reacherJobId}` : ""}
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
              className="btn btn-secondary h-10 w-10 px-0"
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

      <section className="app-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {filters.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setResultFilter(item.value);
                  setPage(1);
                }}
                className={[
                  "filter-button",
                  resultFilter === item.value
                    ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                ].join(" ")}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                className="input h-10 w-full pl-9 sm:w-72"
                placeholder="Search email"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-zinc-200 p-4">
          <div className="basis-full rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900">
            Downloads include completed rows only. Current downloadable result rows:{" "}
            <span className="font-semibold">{progress.downloadableResults}</span>
            {progress.status !== "completed" ? " while this job continues processing." : "."}
          </div>
          {downloads.map((kind) => {
            const isAvailable = canDownload || (kind === "duplicates" && progress.duplicatesRemoved > 0);

            return (
              <a
                key={kind}
                href={apiUrl(`/bulk-jobs/${id}/download/${kind}`)}
                className={[
                  "focus-ring inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition duration-200 active:scale-[0.98]",
                  isAvailable
                    ? "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                    : "pointer-events-none border-zinc-200 bg-zinc-100 text-zinc-400"
                ].join(" ")}
              >
                <Download size={16} />
                {kind}
              </a>
            );
          })}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="table-head">
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
              {pagedResults.map((result) => (
                <tr key={result.id} className="table-row">
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
        </div>
        {resultsQuery.isLoading ? (
          <div className="border-t border-zinc-200 p-6 text-center text-sm text-zinc-500">Loading results</div>
        ) : !visibleResults.length ? (
          <div className="border-t border-zinc-200 p-6 text-center text-sm text-zinc-500">No results</div>
        ) : (
          <PaginationControls
            page={page}
            pageSize={pageSize}
            totalItems={visibleResults.length}
            label="emails"
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </section>
    </div>
  );
}

function isCategoryFilter(value: ResultFilter): value is Category {
  return ["valid", "invalid", "risky", "unknown"].includes(value);
}

function formatDuration(totalSeconds: number) {
  if (!totalSeconds) return "0s";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
