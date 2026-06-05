import type { Category, BulkStatus } from "../types";

const categoryClasses: Record<Category, string> = {
  valid: "border-teal-200 bg-teal-50 text-teal-800",
  invalid: "border-rose-200 bg-rose-50 text-rose-800",
  risky: "border-amber-200 bg-amber-50 text-amber-800",
  unknown: "border-zinc-200 bg-zinc-100 text-zinc-700"
};

const statusClasses: Record<BulkStatus, string> = {
  pending: "border-sky-200 bg-sky-50 text-sky-800",
  processing: "border-indigo-200 bg-indigo-50 text-indigo-800",
  completed: "border-teal-200 bg-teal-50 text-teal-800",
  failed: "border-rose-200 bg-rose-50 text-rose-800",
  cancelled: "border-zinc-200 bg-zinc-100 text-zinc-700"
};

export function CategoryBadge({ value }: { value: Category | null | undefined }) {
  if (!value) return <span className="text-zinc-400">-</span>;
  return <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${categoryClasses[value]}`}>{value}</span>;
}

export function StatusBadge({ value }: { value: BulkStatus }) {
  return <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClasses[value]}`}>{value}</span>;
}

