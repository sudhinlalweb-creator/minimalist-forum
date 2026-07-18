import Link from "next/link";

/**
 * Real pagination with indexable `?page=N` URLs, not infinite scroll — the spec
 * prefers crawlable pages over a JS-driven feed.
 *
 * Links are plain anchors so a crawler can follow them without executing JS,
 * and prev/next are also emitted as rel hints in each page's metadata.
 */
export function Pagination({
  basePath,
  page,
  pageCount,
}: {
  basePath: string;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;

  const href = (n: number) => (n === 1 ? basePath : `${basePath}?page=${n}`);

  // A compact window around the current page, always including first and last,
  // so the link graph stays shallow even with many pages.
  const numbers = new Set<number>([1, pageCount, page]);
  if (page - 1 > 1) numbers.add(page - 1);
  if (page + 1 < pageCount) numbers.add(page + 1);
  const ordered = [...numbers].sort((a, b) => a - b);

  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center gap-2">
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          rel="prev"
          className="text-sm text-text-secondary hover:text-text px-2 py-1"
        >
          ← Previous
        </Link>
      ) : null}

      {ordered.map((n, i) => {
        const gap = i > 0 && n - ordered[i - 1] > 1;
        return (
          <span key={n} className="flex items-center gap-2">
            {gap ? <span className="text-xs text-text-tertiary">…</span> : null}
            {n === page ? (
              <span
                aria-current="page"
                className="text-sm text-text bg-hover-bg rounded-md px-2.5 py-1 font-medium"
              >
                {n}
              </span>
            ) : (
              <Link
                href={href(n)}
                className="text-sm text-text-secondary hover:text-text px-2.5 py-1"
              >
                {n}
              </Link>
            )}
          </span>
        );
      })}

      {page < pageCount ? (
        <Link
          href={href(page + 1)}
          rel="next"
          className="text-sm text-text-secondary hover:text-text px-2 py-1"
        >
          Next →
        </Link>
      ) : null}
    </nav>
  );
}
