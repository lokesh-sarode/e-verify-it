import { useQuery } from "@tanstack/react-query";
import { FileStack } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { PaginationControls } from "../components/PaginationControls";
import { StatusBadge } from "../components/StatusBadge";
import type { BulkJob } from "../types";

export function BulkJobsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data = [], isLoading } = useQuery({
    queryKey: ["bulk-jobs"],
    queryFn: async () => (await api.get<BulkJob[]>("/bulk-jobs?take=100")).data,
    refetchInterval: 5000
  });

  const pagedJobs = useMemo(() => {
    const safePage = Math.min(page, Math.max(1, Math.ceil(data.length / pageSize)));
    const start = (safePage - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, page, pageSize]);

  if (isLoading) {
    return (
      <div className="app-panel p-6 text-sm text-zinc-500">
        Loading jobs
      </div>
    );
  }

  return (
    <section className="app-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">Bulk jobs</h2>
          <p className="mt-1 text-sm text-zinc-500">Showing the latest {data.length} loaded jobs</p>
        </div>
        <Link to="/bulk-upload" className="btn btn-primary">
          New upload
        </Link>
      </div>

      {data.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Mode</th>
                <th className="px-4 py-3 font-medium">Unique</th>
                <th className="px-4 py-3 font-medium">Processed</th>
                <th className="px-4 py-3 font-medium">Valid</th>
                <th className="px-4 py-3 font-medium">Invalid</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {pagedJobs.map((job) => (
                <tr key={job.id} className="table-row">
                  <td className="px-4 py-3">
                    <Link to={`/bulk-jobs/${job.id}`} className="font-semibold text-zinc-950 transition hover:text-brand-700">
                      {job.filename}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><StatusBadge value={job.status} /></td>
                  <td className="px-4 py-3 text-zinc-600">{job.mode ?? "-"}</td>
                  <td className="px-4 py-3">{job.uniqueEmails}</td>
                  <td className="px-4 py-3">{job.processed}</td>
                  <td className="px-4 py-3">{job.validCount}</td>
                  <td className="px-4 py-3">{job.invalidCount}</td>
                  <td className="px-4 py-3 text-zinc-500">{new Date(job.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationControls
            page={page}
            pageSize={pageSize}
            totalItems={data.length}
            label="jobs"
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      ) : (
        <div className="p-4">
          <EmptyState icon={<FileStack size={28} />} title="No bulk jobs found" />
        </div>
      )}
    </section>
  );
}
