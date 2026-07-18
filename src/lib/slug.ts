/**
 * URL slugs are a ranking surface, not cosmetics — the spec calls for
 * descriptive slugs over numeric ids (`/c/design/shadow-depth-as-a-signal-12`).
 */
export function slugify(input: string, maxLength = 72): string {
  const base = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/['’"]/g, "") // don't turn "what's" into "what-s"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (base.length <= maxLength) return base;

  // Trim at a word boundary so slugs never end mid-word.
  const clipped = base.slice(0, maxLength);
  const lastDash = clipped.lastIndexOf("-");
  return (lastDash > maxLength * 0.6 ? clipped.slice(0, lastDash) : clipped).replace(
    /-+$/,
    "",
  );
}

/** Canonical thread path: slug carries the keywords, id guarantees uniqueness. */
export function threadPath(
  categorySlug: string,
  threadSlug: string,
  threadId: number,
): string {
  return `/c/${categorySlug}/${threadSlug}-${threadId}`;
}

/** Parses `some-title-123` back into its trailing id. */
export function parseThreadId(segment: string): number | null {
  const match = /-(\d+)$/.exec(segment);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
