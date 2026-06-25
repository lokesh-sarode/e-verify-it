import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, FileSpreadsheet, FileUp, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { ProgressBar } from "../components/ProgressBar";
import { StatusBadge } from "../components/StatusBadge";
import { ToastMessage } from "../components/ToastMessage";
import type { AppConfig, BulkJob, BulkProgress } from "../types";
import { createUploadPreview, formatFileSize, type UploadPreview } from "../utils/uploadPreview";

export function BulkUploadPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [createdJob, setCreatedJob] = useState<BulkJob | null>(null);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const configQuery = useQuery({
    queryKey: ["app-config"],
    queryFn: async () => (await api.get<AppConfig>("/config")).data
  });

  const progressQuery = useQuery({
    queryKey: ["bulk-progress", createdJob?.id],
    queryFn: async () => (await api.get<BulkProgress>(`/bulk-jobs/${createdJob?.id}/progress`)).data,
    enabled: Boolean(createdJob?.id),
    refetchInterval: (queryState) => {
      const status = queryState.state.data?.status;
      return status === "completed" || status === "failed" || status === "cancelled" ? false : 4000;
    }
  });

  const maxUploadMb = configQuery.data?.maxUploadMb ?? 20;
  const maxUploadBytes = maxUploadMb * 1024 * 1024;

  useEffect(() => {
    if (!showSuccessToast) return;
    const timeout = window.setTimeout(() => setShowSuccessToast(false), 4000);
    return () => window.clearTimeout(timeout);
  }, [showSuccessToast]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Select a file");
      const form = new FormData();
      form.append("file", file);
      setUploadProgress(0);
      const response = await api.post<{ job: BulkJob }>("/bulk-jobs/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress(event) {
          if (!event.total) return;
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      });
      return response.data.job;
    },
    onSuccess(job) {
      setCreatedJob(job);
      setUploadProgress(100);
      setError(null);
      setShowSuccessToast(true);
    },
    onError(err) {
      setError(apiErrorMessage(err));
    }
  });

  function pickFile(nextFile: File | undefined) {
    if (!nextFile) return;
    if (nextFile.size > maxUploadBytes) {
      setFile(null);
      setCreatedJob(null);
      setError(`File exceeds ${maxUploadMb} MB`);
      return;
    }

    setFile(nextFile);
    setCreatedJob(null);
    setError(null);
    setPreviewError(null);
    setPreview(null);
    setUploadProgress(0);
    setIsPreviewing(true);

    void createUploadPreview(nextFile)
      .then((nextPreview) => setPreview(nextPreview))
      .catch((err) => setPreviewError(apiErrorMessage(err)))
      .finally(() => setIsPreviewing(false));
  }

  function cancelSelection() {
    setFile(null);
    setCreatedJob(null);
    setPreview(null);
    setError(null);
    setPreviewError(null);
    setUploadProgress(0);
    setShowSuccessToast(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    pickFile(event.dataTransfer.files[0]);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[440px_1fr]">
      {showSuccessToast ? <ToastMessage>Job created. Processing has started.</ToastMessage> : null}

      <section className="app-panel p-5">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand-50 text-brand-700">
            <FileUp size={21} />
          </div>
          <h2 className="text-base font-semibold text-zinc-950">Upload file</h2>
        </div>

        {error ? <div className="mb-4"><ErrorBanner message={error} /></div> : null}

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={[
            "flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center transition",
            isDragging ? "border-brand-600 bg-brand-50" : "border-zinc-300 bg-zinc-50 hover:bg-zinc-100"
          ].join(" ")}
          onClick={() => inputRef.current?.click()}
        >
          <UploadCloud size={34} className="text-zinc-500" />
          <p className="mt-3 text-sm font-medium text-zinc-800">{file ? file.name : "CSV or XLSX"}</p>
          <p className="mt-1 text-xs text-zinc-500">Max file size {maxUploadMb} MB</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(event) => pickFile(event.target.files?.[0])}
          />
        </div>

        {file && !createdJob ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <button
              type="button"
              disabled={!file || mutation.isPending}
              onClick={() => mutation.mutate()}
              className="btn btn-primary h-11 w-full"
            >
              {mutation.isPending ? "Creating job" : "Create job"}
            </button>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={cancelSelection}
              className="btn btn-secondary h-11 w-full"
            >
              <X size={16} />
              Cancel
            </button>
          </div>
        ) : null}

        {(mutation.isPending || uploadProgress > 0) ? (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium text-zinc-700">Upload</span>
              <span className="text-zinc-500">{uploadProgress}%</span>
            </div>
            <ProgressBar value={uploadProgress} />
          </div>
        ) : null}
      </section>

      <section className="app-panel p-5">
        {createdJob ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-950">{createdJob.filename}</h2>
                <p className="mt-1 text-sm text-zinc-500">{new Date(createdJob.createdAt).toLocaleString()}</p>
              </div>
              <StatusBadge value={createdJob.status} />
            </div>

            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["Original rows", createdJob.originalRows],
                ["Empty rows", createdJob.emptyRows],
                ["Duplicates", createdJob.duplicateRows],
                ["Syntax invalid", createdJob.syntaxInvalidRows],
                ["Unique to check", createdJob.uniqueEmails],
                ["Processed", createdJob.processed]
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase tracking-normal text-zinc-500">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold text-zinc-950">{value}</dd>
                </div>
              ))}
            </dl>

            {progressQuery.data ? (
              <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-zinc-700">Processing</span>
                  <span className="text-zinc-500">{progressQuery.data.progressPercentage}%</span>
                </div>
                <ProgressBar value={progressQuery.data.progressPercentage} />
                <div className="grid gap-2 text-xs text-zinc-500 sm:grid-cols-3">
                  <span>Processed {progressQuery.data.processed}/{progressQuery.data.uniqueEmails}</span>
                  <span>Elapsed {formatDuration(progressQuery.data.elapsedSeconds)}</span>
                  <span>ETA {formatDuration(progressQuery.data.estimatedRemainingSeconds)}</span>
                </div>
              </div>
            ) : null}

            <Link
              to={`/bulk-jobs/${createdJob.id}`}
              className="btn btn-primary"
            >
              Open job
            </Link>
          </div>
        ) : file ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-brand-700">Preview</p>
                <h2 className="mt-1 text-base font-semibold text-zinc-950">{file.name}</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {formatFileSize(file.size)}{preview ? ` - ${new Date(preview.uploadedAt).toLocaleString()}` : ""}
                </p>
              </div>
              {preview ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                  <CheckCircle2 size={14} />
                  Ready
                </span>
              ) : null}
            </div>

            {isPreviewing ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">Reading preview</div>
            ) : null}

            {previewError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                <span className="inline-flex items-center gap-2">
                  <AlertCircle size={16} />
                  {previewError}. You can still create the job and let the server validate the file.
                </span>
              </div>
            ) : null}

            {preview ? (
              <>
                <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    ["Total emails", preview.totalEmailCount],
                    ["Unique valid", preview.uniqueValidCount],
                    ["Duplicates", preview.duplicateCount],
                    ["Valid format", preview.validFormatCount],
                    ["Invalid format", preview.invalidFormatCount]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                      <dt className="text-xs font-medium uppercase tracking-normal text-zinc-500">{label}</dt>
                      <dd className="mt-1 text-lg font-semibold text-zinc-950">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="overflow-hidden rounded-lg border border-zinc-200">
                  <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-900">
                    First {preview.previewRecords.length} email records
                  </div>
                  <div className="max-h-96 overflow-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="table-head">
                        <tr>
                          <th className="px-4 py-3 font-medium">Row</th>
                          <th className="px-4 py-3 font-medium">Email</th>
                          <th className="px-4 py-3 font-medium">Preview status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {preview.previewRecords.map((record) => (
                          <tr key={`${record.rowNumber}-${record.email}`} className="table-row">
                            <td className="px-4 py-3 text-zinc-500">{record.rowNumber}</td>
                            <td className="px-4 py-3 font-medium text-zinc-950">{record.email}</td>
                            <td className="px-4 py-3">
                              <span className={[
                                "inline-flex min-w-20 items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize",
                                record.status === "valid"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                  : record.status === "duplicate"
                                    ? "border-amber-200 bg-amber-50 text-amber-800"
                                    : "border-rose-200 bg-rose-50 text-rose-800"
                              ].join(" ")}>
                                {record.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-center text-zinc-500">
            <FileSpreadsheet size={34} />
            <p className="text-sm font-semibold">Upload preview</p>
            <p className="max-w-sm text-xs text-zinc-500">Select a CSV or XLSX file to review counts and sample records before creating a job.</p>
          </div>
        )}
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
