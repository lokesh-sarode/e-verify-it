import type { ReactNode } from "react";

export function EmptyState({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50/80 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-zinc-400 shadow-sm">{icon}</div>
      <p className="text-sm font-semibold text-zinc-700">{title}</p>
    </div>
  );
}
