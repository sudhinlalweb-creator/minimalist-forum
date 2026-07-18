import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseThreadId, slugify, threadPath } from "./slug";

describe("slugify", () => {
  it("lowercases and joins words with hyphens", () => {
    assert.equal(slugify("Shadow Depth As A Signal"), "shadow-depth-as-a-signal");
  });

  it("strips diacritics rather than dropping the letters", () => {
    assert.equal(slugify("Café Naïve Über"), "cafe-naive-uber");
  });

  it("drops apostrophes instead of splitting the word", () => {
    // The regex handles both ASCII and typographic apostrophes; "what's"
    // becoming "what-s" would read as two words to a crawler.
    assert.equal(slugify("What's minimal"), "whats-minimal");
    assert.equal(slugify("What’s minimal"), "whats-minimal");
  });

  it("collapses runs of punctuation and whitespace into one hyphen", () => {
    assert.equal(slugify("a  --  b??!!  c"), "a-b-c");
  });

  it("trims leading and trailing separators", () => {
    assert.equal(slugify("  ...hello world!  "), "hello-world");
  });

  it("returns an empty string when nothing survives", () => {
    // Callers append `-{id}`, so an empty slug still yields a unique path.
    assert.equal(slugify("!!!"), "");
    assert.equal(slugify(""), "");
    assert.equal(slugify("日本語"), "");
  });

  it("does not exceed maxLength", () => {
    const long = "word ".repeat(60);
    assert.ok(slugify(long).length <= 72);
    assert.ok(slugify(long, 20).length <= 20);
  });

  it("clips at a word boundary and never ends mid-word", () => {
    const slug = slugify("alpha bravo charlie delta echo foxtrot", 20);
    assert.ok(!slug.endsWith("-"));
    // Every retained segment should be a whole input word.
    for (const part of slug.split("-")) {
      assert.ok(
        ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"].includes(part),
        `"${part}" is a partial word`,
      );
    }
  });

  it("falls back to a hard clip when the boundary would lose most of the slug", () => {
    // A single long token has no dash past 60% of the limit, so trimming to a
    // boundary would gut it. The hard clip keeps the slug useful.
    const slug = slugify("supercalifragilisticexpialidocious", 10);
    assert.equal(slug, "supercalif");
  });

  it("produces slugs that survive a round trip through a URL", () => {
    const slug = slugify("Migrating the thread renderer off virtualized lists");
    assert.equal(encodeURIComponent(slug), slug);
  });
});

describe("threadPath", () => {
  it("composes a canonical path with the id last", () => {
    assert.equal(threadPath("design", "shadow-depth", 12), "/c/design/shadow-depth-12");
  });

  it("round-trips through parseThreadId", () => {
    const id = 4821;
    const segment = threadPath("c", "some-title", id).split("/").pop()!;
    assert.equal(parseThreadId(segment), id);
  });

  it("round-trips even when the slug is empty", () => {
    const segment = threadPath("c", "", 7).split("/").pop()!;
    assert.equal(parseThreadId(segment), 7);
  });

  it("round-trips when the slug itself ends in digits", () => {
    // "covid-19-2" must resolve to thread 2, not 19.
    const segment = threadPath("c", "covid-19", 2).split("/").pop()!;
    assert.equal(parseThreadId(segment), 2);
  });
});

describe("parseThreadId", () => {
  it("reads the trailing id", () => {
    assert.equal(parseThreadId("some-title-123"), 123);
  });

  it("takes only the final numeric group", () => {
    assert.equal(parseThreadId("top-10-lists-of-2024-88"), 88);
  });

  it("rejects a segment with no trailing id", () => {
    assert.equal(parseThreadId("some-title"), null);
    assert.equal(parseThreadId(""), null);
    assert.equal(parseThreadId("123"), null); // no separator
  });

  it("rejects non-positive ids", () => {
    assert.equal(parseThreadId("title-0"), null);
    // The leading "-" is the separator, so "-5" parses as 5 preceded by an
    // empty slug rather than as a negative number.
    assert.equal(parseThreadId("title--5"), 5);
  });

  it("rejects ids beyond safe integer range", () => {
    assert.equal(parseThreadId("title-99999999999999999999"), null);
  });

  it("does not accept non-digit characters in the id", () => {
    assert.equal(parseThreadId("title-12a"), null);
    assert.equal(parseThreadId("title-0x10"), null);
    // The hyphen must sit immediately before the digits, so a decimal point
    // breaks the match rather than yielding the fractional part.
    assert.equal(parseThreadId("title-1.5"), null);
  });

  it("ignores whitespace-padded input rather than coercing it", () => {
    assert.equal(parseThreadId("title-12 "), null);
  });
});
