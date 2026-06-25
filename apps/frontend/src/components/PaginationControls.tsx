const pageSizes = [10, 25, 50, 100];

export function PaginationControls({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  label = "records"
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  label?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(totalItems, safePage * pageSize);

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
      <div>
        Showing <span className="font-semibold text-zinc-900">{start}-{end}</span> of{" "}
        <span className="font-semibold text-zinc-900">{totalItems}</span> {label}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase text-zinc-500">Page size</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="input h-9 w-24"
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="btn btn-secondary h-9 px-3"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          Previous
        </button>

        <label className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase text-zinc-500">Page</span>
          <select
            value={safePage}
            onChange={(event) => onPageChange(Number(event.target.value))}
            className="input h-9 w-20"
          >
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <span className="text-zinc-500">of {totalPages}</span>
        </label>

        <button
          type="button"
          className="btn btn-secondary h-9 px-3"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
