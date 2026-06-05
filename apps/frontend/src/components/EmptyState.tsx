import type { ReactNode } from "react";

export function EmptyState({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
      <div className="text-zinc-400">{icon}</div>
      <p className="text-sm font-medium text-zinc-700">{title}</p>
    </div>
  );
}

