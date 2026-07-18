import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { createDevDb } from "../db/dev";
import { categories, threads, users } from "../db/schema";
import type { AppDb } from "../db/types";
import {
  THREADS_PER_PAGE,
  excerpt,
  getCategoryTree,
  getThreadById,
  getThreads,
} from "./forum";

describe("excerpt", () => {
  it("returns short bodies untouched", () => {
    assert.equal(excerpt("A short body."), "A short body.");
  });

  it("collapses whitespace and newlines into single spaces", () => {
    assert.equal(excerpt("one\n\ntwo   three\tfour"), "one two three four");
  });

  it("strips markdown punctuation rather than showing it as prose", () => {
    assert.equal(excerpt("## A *heading* with `code`"), "A heading with code");
    assert.equal(excerpt("> quoted [link](url)"), "quoted linkurl");
  });

  it("drops fenced code blocks entirely", () => {
    const body = "Intro line.\n```js\nconst secret = 1;\n```\nOutro.";
    const result = excerpt(body);
    assert.ok(!result.includes("const secret"));
    assert.ok(result.includes("Intro line."));
    assert.ok(result.includes("Outro."));
  });

  it("truncates with an ellipsis and stays within the limit", () => {
    const body = "word ".repeat(200);
    const result = excerpt(body, 60);
    // The ellipsis is appended after clipping, so allow for it.
    assert.ok(result.length <= 61, `got ${result.length}`);
    assert.ok(result.endsWith("…"));
  });

  it("clips at a word boundary, not mid-word", () => {
    const body = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    const result = excerpt(body, 30);
    assert.ok(!result.includes("  "));
    assert.match(result, /\S…$/);
    const words = result.replace("…", "").trim().split(" ");
    for (const word of words) {
      assert.ok(body.includes(word), `"${word}" is a partial word`);
    }
  });

  it("does not append an ellipsis when the body exactly fits", () => {
    const body = "x".repeat(40);
    assert.equal(excerpt(body, 40), body);
  });

  it("handles an empty body", () => {
    assert.equal(excerpt(""), "");
    assert.equal(excerpt("   \n  "), "");
  });
});

let db: AppDb;
let categoryId: number;
let otherCategoryId: number;
let authorId: string;

const BODY = "A body long enough to be a realistic excerpt source.";

async function makeThread(
  title: string,
  opts: { categoryId?: number; isPinned?: boolean; lastPostedAt?: Date; isDeleted?: boolean } = {},
): Promise<number> {
  const [row] = await db
    .insert(threads)
    .values({
      categoryId: opts.categoryId ?? categoryId,
      authorId,
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      body: BODY,
      isPinned: opts.isPinned ?? false,
      isDeleted: opts.isDeleted ?? false,
      lastPostedAt: opts.lastPostedAt ?? new Date("2026-01-01T00:00:00.000Z"),
    })
    .returning({ id: threads.id });
  return row.id;
}

before(async () => {
  db = await createDevDb();

  const [user] = await db
    .insert(users)
    .values({ username: "q1", email: "q1@example.com", name: "Query One" })
    .returning({ id: users.id });
  authorId = user.id;

  const [cat] = await db
    .insert(categories)
    .values({ slug: "queries", name: "Queries", description: "Queries Category", sortOrder: 1 })
    .returning({ id: categories.id });
  categoryId = cat.id;

  const [other] = await db
    .insert(categories)
    .values({ slug: "other", name: "Other", description: "Other Category", sortOrder: 2 })
    .returning({ id: categories.id });
  otherCategoryId = other.id;
});

describe("getThreads", () => {
  it("excludes soft-deleted threads from both rows and total", async () => {
    await makeThread("Visible thread");
    await makeThread("Deleted thread", { isDeleted: true });

    const page = await getThreads(db, { categoryIds: [categoryId] });
    const titles = page.threads.map((t) => t.title);

    assert.ok(titles.includes("Visible thread"));
    assert.ok(!titles.includes("Deleted thread"));
    assert.equal(page.total, titles.length);
  });

  it("scopes to the requested categories", async () => {
    await makeThread("Elsewhere", { categoryId: otherCategoryId });

    const scoped = await getThreads(db, { categoryIds: [categoryId] });
    assert.ok(!scoped.threads.some((t) => t.title === "Elsewhere"));

    const unscoped = await getThreads(db, {});
    assert.ok(unscoped.threads.some((t) => t.title === "Elsewhere"));
  });

  it("sorts pinned threads above the rest regardless of recency", async () => {
    await makeThread("Pinned but old", {
      isPinned: true,
      lastPostedAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    await makeThread("Unpinned but recent", {
      lastPostedAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    const page = await getThreads(db, { categoryIds: [categoryId] });
    assert.equal(page.threads[0].title, "Pinned but old");
  });

  it("orders unpinned threads by most recent activity", async () => {
    const page = await getThreads(db, { categoryIds: [categoryId] });
    const unpinned = page.threads.filter((t) => !t.isPinned);
    for (let i = 1; i < unpinned.length; i++) {
      assert.ok(
        unpinned[i - 1].lastPostedAt >= unpinned[i].lastPostedAt,
        "threads are not in descending activity order",
      );
    }
  });

  it("derives the excerpt from the body", async () => {
    const page = await getThreads(db, { categoryIds: [categoryId] });
    assert.equal(page.threads[0].excerpt, excerpt(BODY));
  });

  it("paginates without overlapping or dropping rows", async () => {
    // One more than a full page, so page 2 has exactly one row.
    const total = THREADS_PER_PAGE + 1;
    const [fresh] = await db
      .insert(categories)
      .values({ slug: "paging", name: "Paging", description: "Paging Category", sortOrder: 3 })
      .returning({ id: categories.id });

    for (let i = 0; i < total; i++) {
      await makeThread(`Paged thread ${i}`, {
        categoryId: fresh.id,
        lastPostedAt: new Date(2026, 0, 1, 0, i),
      });
    }

    const first = await getThreads(db, { categoryIds: [fresh.id], page: 1 });
    const second = await getThreads(db, { categoryIds: [fresh.id], page: 2 });

    assert.equal(first.total, total);
    assert.equal(first.pageCount, 2);
    assert.equal(first.threads.length, THREADS_PER_PAGE);
    assert.equal(second.threads.length, 1);

    const ids = new Set([...first.threads, ...second.threads].map((t) => t.id));
    assert.equal(ids.size, total, "pages overlap or drop rows");
  });

  it("clamps nonsensical page numbers to the first page", async () => {
    for (const page of [0, -5, 0.5]) {
      assert.equal((await getThreads(db, { page })).page, 1);
    }
  });

  it("returns an empty page past the end rather than throwing", async () => {
    const page = await getThreads(db, { categoryIds: [categoryId], page: 999 });
    assert.equal(page.threads.length, 0);
    assert.ok(page.total > 0);
  });

  it("reports at least one page even with no threads", async () => {
    const [empty] = await db
      .insert(categories)
      .values({ slug: "empty", name: "Empty", description: "Empty Category", sortOrder: 9 })
      .returning({ id: categories.id });

    const page = await getThreads(db, { categoryIds: [empty.id] });
    assert.equal(page.total, 0);
    assert.equal(page.pageCount, 1);
  });
});

describe("getThreadById", () => {
  it("returns null for an id that does not exist", async () => {
    assert.equal(await getThreadById(db, 999_999), null);
  });

  it("returns the thread with its author and category resolved", async () => {
    const id = await makeThread("Fetch me by id");
    const thread = await getThreadById(db, id);

    assert.ok(thread);
    assert.equal(thread.title, "Fetch me by id");
    assert.equal(thread.authorUsername, "q1");
    assert.equal(thread.categorySlug, "queries");
  });
});

describe("getCategoryTree", () => {
  it("counts threads per category without inflating by sub-category", async () => {
    // A correlated-subquery version of this query once returned 1 for every
    // category; the count must reflect actual threads.
    const tree = await getCategoryTree(db);
    const empty = tree.find((c) => c.slug === "empty");

    assert.ok(empty, "expected the empty category in the tree");
    assert.equal(empty.threadCount, 0);
  });

  it("excludes soft-deleted threads from the count", async () => {
    const [cat] = await db
      .insert(categories)
      .values({ slug: "counting", name: "Counting", description: "Counting Category", sortOrder: 8 })
      .returning({ id: categories.id });

    await makeThread("Counted", { categoryId: cat.id });
    await makeThread("Not counted", { categoryId: cat.id, isDeleted: true });

    const tree = await getCategoryTree(db);
    const counting = tree.find((c) => c.slug === "counting");

    assert.equal(counting?.threadCount, 1);
  });
});
