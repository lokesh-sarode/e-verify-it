import { useQuery } from "@tanstack/react-query";
import { FileStack } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import type { BulkJob } from "../types";

export function BulkJobsPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["bulk-jobs"],
    queryFn: async () => (await api.get<BulkJob[]>("/bulk-jobs")).data,
    refetchInterval: 5000
  });

  if (isLoading) return <div className="text-sm text-zinc-500">Loading jobs</div>;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-soft">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Bulk jobs</h2>
        <Link to="/bulk-upload" className="text-sm font-medium text-teal-700 hover:text-teal-900">
          New upload
        </Link>
      </div>

      {data.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-normal text-zinc-500">
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
              {data.map((job) => (
                <tr key={job.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link to={`/bulk-jobs/${job.id}`} className="font-medium text-zinc-950 hover:text-teal-700">
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
        </div>
      ) : (
        <div className="p-4">
          <EmptyState icon={<FileStack size={28} />} title="No bulk jobs found" />
        </div>
      )}
    </section>
  );
}

