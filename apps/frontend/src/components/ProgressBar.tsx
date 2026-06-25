export function ProgressBar({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(value, 100));

  return (
    <div className="h-3 overflow-hidden rounded-full bg-zinc-200/80">
      <div
        className="h-full rounded-full bg-brand-600 shadow-sm transition-all duration-500"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}
