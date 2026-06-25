export function RawJson({ value }: { value: unknown }) {
  return (
    <details className="rounded-lg border border-zinc-200 bg-zinc-50 shadow-sm">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-800 transition hover:text-brand-700">Raw JSON</summary>
      <pre className="max-h-96 overflow-auto border-t border-zinc-200 p-4 text-xs text-zinc-700">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
