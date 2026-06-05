import { useMutation } from "@tanstack/react-query";
import { FileSpreadsheet, FileUp, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { StatusBadge } from "../components/StatusBadge";
import type { BulkJob } from "../types";

export function BulkUploadPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdJob, setCreatedJob] = useState<BulkJob | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Select a file");
      const form = new FormData();
      form.append("file", file);
      const response = await api.post<{ job: BulkJob }>("/bulk-jobs/upload", form, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      return response.data.job;
    },
    onSuccess(job) {
      setCreatedJob(job);
      setError(null);
    },
    onError(err) {
      setError(apiErrorMessage(err));
    }
  });

  function pickFile(nextFile: File | undefined) {
    if (!nextFile) return;
    setFile(nextFile);
    setCreatedJob(null);
    setError(null);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    pickFile(event.dataTransfer.files[0]);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[440px_1fr]">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-sky-50 text-sky-700">
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
            isDragging ? "border-teal-400 bg-teal-50" : "border-zinc-300 bg-zinc-50 hover:bg-zinc-100"
          ].join(" ")}
          onClick={() => inputRef.current?.click()}
        >
          <UploadCloud size={34} className="text-zinc-500" />
          <p className="mt-3 text-sm font-medium text-zinc-800">{file ? file.name : "CSV or XLSX"}</p>
          <p className="mt-1 text-xs text-zinc-500">Max file size follows server settings</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(event) => pickFile(event.target.files?.[0])}
          />
        </div>

        <button
          type="button"
          disabled={!file || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="focus-ring mt-4 flex h-11 w-full items-center justify-center rounded-md bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {mutation.isPending ? "Uploading" : "Create bulk job"}
        </button>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
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

            <Link
              to={`/bulk-jobs/${createdJob.id}`}
              className="focus-ring inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              Open job
            </Link>
          </div>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-center text-zinc-500">
            <FileSpreadsheet size={34} />
            <p className="text-sm font-medium">Upload summary</p>
          </div>
        )}
      </section>
    </div>
  );
}

