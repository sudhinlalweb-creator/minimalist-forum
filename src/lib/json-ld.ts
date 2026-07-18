/**
 * Safe serialisation for JSON-LD injected into a <script> tag.
 *
 * `JSON.stringify` escapes quotes and backslashes but leaves `<` and `/`
 * alone, so a thread titled `</script><img src=x onerror=...>` closes the
 * script element early and everything after it is parsed as HTML. Any user who
 * can name a thread, category or account could then run script on every
 * visitor's page — the payload reaches the markup through the SEO block, which
 * React's escaping elsewhere does nothing to protect.
 *
 * Escaping to `\uXXXX` keeps the document valid JSON: a consumer parses
 * `<` straight back to `<`, so crawlers still read the original text.
 *
 * U+2028 and U+2029 are included because they are valid inside a JSON string
 * but terminate a line in JavaScript, which breaks any consumer that evaluates
 * the block rather than parsing it. They are built with fromCharCode so the
 * source carries no invisible bytes for an editor to strip.
 */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

const ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  [LINE_SEPARATOR]: "\\u2028",
  [PARAGRAPH_SEPARATOR]: "\\u2029",
};

const UNSAFE = new RegExp(`[<>&${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, "g");

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(UNSAFE, (char) => ESCAPES[char]);
}
