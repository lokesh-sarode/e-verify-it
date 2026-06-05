import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  icon,
  tone = "neutral"
}: {
  label: string;
  value: number | string;
  icon: ReactNode;
  tone?: "neutral" | "teal" | "rose" | "amber" | "sky";
}) {
  const tones = {
    neutral: "bg-zinc-100 text-zinc-700",
    teal: "bg-teal-50 text-teal-700",
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
    sky: "bg-sky-50 text-sky-700"
  };

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-normal text-zinc-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${tones[tone]}`}>{icon}</div>
      </div>
    </div>
  );
}

