import type { ReactNode } from "react";

export function ToastMessage({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-50 max-w-sm rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-panel">
      {children}
    </div>
  );
}
