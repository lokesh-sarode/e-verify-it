import type { Category, BulkStatus } from "../types";

const categoryClasses: Record<Category, string> = {
  valid: "border-emerald-200 bg-emerald-50 text-emerald-800",
  invalid: "border-rose-200 bg-rose-50 text-rose-800",
  risky: "border-amber-200 bg-amber-50 text-amber-800",
  unknown: "border-slate-200 bg-slate-100 text-slate-700"
};

const statusClasses: Record<BulkStatus, string> = {
  pending: "border-sky-200 bg-sky-50 text-sky-800",
  processing: "border-brand-100 bg-brand-50 text-brand-800",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-rose-200 bg-rose-50 text-rose-800",
  cancelled: "border-slate-200 bg-slate-100 text-slate-700"
};

export function CategoryBadge({ value }: { value: Category | null | undefined }) {
  if (!value) return <span className="text-zinc-400">-</span>;
  return (
    <span className={`inline-flex min-w-16 items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${categoryClasses[value]}`}>
      {value}
    </span>
  );
}

export function StatusBadge({ value }: { value: BulkStatus }) {
  return (
    <span className={`inline-flex min-w-20 items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusClasses[value]}`}>
      {value}
    </span>
  );
}
