import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleHelp, FileStack, Mail, ShieldAlert, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import type { Stats } from "../types";

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: async () => (await api.get<Stats>("/admin/stats")).data,
    refetchInterval: 10000
  });

  if (isLoading || !data) {
    return <div className="app-panel p-6 text-sm text-zinc-500">Loading dashboard</div>;
  }

  const stats = [
    { label: "Total jobs", value: data.totalJobs, icon: <FileStack size={20} />, tone: "sky" as const },
    { label: "Uploaded emails", value: data.totalUploadedEmails, icon: <Mail size={20} />, tone: "neutral" as const },
    { label: "Unique verified", value: data.uniqueEmailsVerified, icon: <CheckCircle2 size={20} />, tone: "teal" as const },
    { label: "Valid", value: data.validCount, icon: <CheckCircle2 size={20} />, tone: "teal" as const },
    { label: "Invalid", value: data.invalidCount, icon: <ShieldAlert size={20} />, tone: "rose" as const },
    { label: "Risky", value: data.riskyCount, icon: <TriangleAlert size={20} />, tone: "amber" as const },
    { label: "Unknown", value: data.unknownCount, icon: <CircleHelp size={20} />, tone: "neutral" as const }
  ];

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="app-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">Latest jobs</h2>
            <p className="mt-1 text-sm text-zinc-500">Recent bulk verification activity</p>
          </div>
          <Link to="/bulk-jobs" className="btn btn-secondary">
            View all
          </Link>
        </div>
        {data.latestJobs.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Unique</th>
                  <th className="px-4 py-3 font-medium">Processed</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.latestJobs.map((job) => (
                  <tr key={job.id} className="table-row">
                    <td className="px-4 py-3">
                      <Link to={`/bulk-jobs/${job.id}`} className="font-semibold text-zinc-950 transition hover:text-brand-700">
                        {job.filename}
                      </Link>
                    </td>
                    <td className="px-4 py-3"><StatusBadge value={job.status} /></td>
                    <td className="px-4 py-3">{job.uniqueEmails}</td>
                    <td className="px-4 py-3">{job.processed}</td>
                    <td className="px-4 py-3 text-zinc-500">{new Date(job.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState icon={<FileStack size={28} />} title="No bulk jobs yet" />
          </div>
        )}
      </section>
    </div>
  );
}
