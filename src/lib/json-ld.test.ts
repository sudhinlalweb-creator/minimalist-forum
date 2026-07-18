import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serializeJsonLd } from "./json-ld";

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/** Reproduces how the pages embed the payload. */
function renderScriptTag(data: unknown): string {
  return `<script type="application/ld+json">${serializeJsonLd(data)}</script>`;
}

describe("script-tag breakout", () => {
  it("neutralises a closing script tag in user content", () => {
    const payload = { headline: "</script><img src=x onerror=alert(1)>" };
    const html = renderScriptTag(payload);

    // Exactly one closing tag: the real one that ends the block.
    assert.equal(html.match(/<\/script>/gi)?.length, 1);
    assert.ok(html.endsWith("</script>"));
  });

  it("escapes every angle bracket and ampersand, wherever they appear", () => {
    const serialized = serializeJsonLd({
      a: "<b>",
      b: "tom & jerry",
      nested: { deep: ["</SCRIPT>", "x > y"] },
    });

    assert.ok(!serialized.includes("<"));
    assert.ok(!serialized.includes(">"));
    assert.ok(!serialized.includes("&"));
  });

  it("escapes content hidden in object keys, not just values", () => {
    const serialized = serializeJsonLd({ "</script>": "value" });
    assert.ok(!serialized.includes("<"));
  });

  it("is case-insensitive to the injected tag, since HTML parsing is", () => {
    for (const variant of ["</script>", "</SCRIPT>", "</ScRiPt >"]) {
      assert.ok(!renderScriptTag({ x: variant }).slice(0, -9).includes("</"));
    }
  });

  it("blocks the comment-based breakout too", () => {
    // <!-- inside a script element also shifts the parser's state.
    const serialized = serializeJsonLd({ x: "<!--<script>" });
    assert.ok(!serialized.includes("<!--"));
  });
});

describe("JSON validity", () => {
  it("still parses back to the original value", () => {
    const original = {
      headline: "</script><img src=x>",
      author: { name: "A & B", bio: "5 > 3 and 2 < 4" },
      tags: ["<one>", "two & three"],
    };

    assert.deepEqual(JSON.parse(serializeJsonLd(original)), original);
  });

  it("round-trips the line separators that break JavaScript parsers", () => {
    const original = { text: `a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c` };
    const serialized = serializeJsonLd(original);

    assert.ok(!serialized.includes(LINE_SEPARATOR));
    assert.ok(!serialized.includes(PARAGRAPH_SEPARATOR));
    assert.deepEqual(JSON.parse(serialized), original);
  });

  it("leaves ordinary content byte-identical to JSON.stringify", () => {
    // No gratuitous escaping: a crawler reading a normal document sees exactly
    // what it would have before.
    const plain = { "@type": "DiscussionForumPosting", headline: "A normal title" };
    assert.equal(serializeJsonLd(plain), JSON.stringify(plain));
  });

  it("preserves non-ASCII text without mangling it", () => {
    const original = { name: "Café Naïve 日本語 — emoji 🎉" };
    assert.deepEqual(JSON.parse(serializeJsonLd(original)), original);
  });

  it("handles the empty and primitive cases", () => {
    assert.equal(serializeJsonLd({}), "{}");
    assert.equal(serializeJsonLd([]), "[]");
    assert.equal(JSON.parse(serializeJsonLd("<x>")), "<x>");
  });
});
