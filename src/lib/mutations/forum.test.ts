import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { ForbiddenError, GUEST_ACTOR, type Actor } from "../auth/permissions";
import { createDevDb } from "../db/dev";
import { categories, postRevisions, posts, threads, users } from "../db/schema";
import type { AppDb } from "../db/types";
import {
  castVote,
  createReply,
  createThread,
  deletePost,
  editPost,
  getUserVotes,
} from "./forum";

let db: AppDb;
let categoryId: number;

const VERIFIED = new Date("2026-01-01");
const NOW = new Date("2026-07-18T12:00:00.000Z");
const BODY = "A body long enough to pass the minimum length check.";
const TITLE = "A title long enough to be valid";

let n = 0;

async function makeActor(
  role: "member" | "moderator" | "admin" = "member",
  opts: { verified?: boolean } = {},
): Promise<Actor> {
  const i = n++;
  const [row] = await db
    .insert(users)
    .values({
      username: `mut${i}`,
      email: `mut${i}@example.com`,
      role,
      emailVerified: opts.verified === false ? null : VERIFIED,
    })
    .returning({ id: users.id });
  return {
    id: row.id,
    role,
    emailVerified: opts.verified === false ? null : VERIFIED,
    isBanned: false,
  };
}

async function makeThread(actor: Actor) {
  const r = await createThread(
    db,
    actor,
    { categoryId, title: `${TITLE} ${n++}`, body: BODY },
    NOW,
  );
  assert.equal(r.ok, true);
  return (r as { threadId: number }).threadId;
}

before(async () => {
  db = (await createDevDb()) as unknown as AppDb;
  const [cat] = await db
    .insert(categories)
    .values({ slug: "test-cat", name: "Test", description: "d" })
    .returning({ id: categories.id });
  categoryId = cat.id;
});

describe("createThread — authorisation", () => {
  it("refuses guests", async () => {
    await assert.rejects(
      () => createThread(db, GUEST_ACTOR, { categoryId, title: TITLE, body: BODY }, NOW),
      ForbiddenError,
    );
  });

  it("refuses unverified members", async () => {
    const actor = await makeActor("member", { verified: false });
    await assert.rejects(
      () => createThread(db, actor, { categoryId, title: TITLE, body: BODY }, NOW),
      ForbiddenError,
    );
  });

  it("allows a verified member", async () => {
    const actor = await makeActor();
    const r = await createThread(db, actor, { categoryId, title: TITLE, body: BODY }, NOW);
    assert.equal(r.ok, true);
  });
});

describe("createThread — validation and slugs", () => {
  it("rejects short titles and bodies", async () => {
    const actor = await makeActor();
    const shortTitle = await createThread(db, actor, { categoryId, title: "Hi", body: BODY }, NOW);
    assert.equal(shortTitle.ok === false && shortTitle.issue, "title_too_short");

    const shortBody = await createThread(db, actor, { categoryId, title: TITLE, body: "no" }, NOW);
    assert.equal(shortBody.ok === false && shortBody.issue, "body_too_short");
  });

  it("de-duplicates slugs for identical titles", async () => {
    const actor = await makeActor();
    const a = await createThread(db, actor, { categoryId, title: "Exactly the same title", body: BODY }, NOW);
    const b = await createThread(db, actor, { categoryId, title: "Exactly the same title", body: BODY }, NOW);
    assert.equal(a.ok && b.ok, true);
    if (!a.ok || !b.ok) return;
    assert.notEqual(a.slug, b.slug);
    assert.equal(a.slug, "exactly-the-same-title");
    assert.equal(b.slug, "exactly-the-same-title-2");
  });
});

describe("createReply — counters", () => {
  it("increments reply_count and moves last_posted_at", async () => {
    const actor = await makeActor();
    const threadId = await makeThread(actor);

    const later = new Date(NOW.getTime() + 60_000);
    const r = await createReply(db, actor, threadId, BODY, later);
    assert.equal(r.ok, true);

    const [row] = await db
      .select({
        replyCount: threads.replyCount,
        lastPostedAt: threads.lastPostedAt,
        updatedAt: threads.updatedAt,
      })
      .from(threads)
      .where(eq(threads.id, threadId));

    assert.equal(row.replyCount, 1);
    assert.equal(row.lastPostedAt.getTime(), later.getTime());
    assert.equal(row.updatedAt.getTime(), later.getTime(), "dateModified must move too");
  });

  it("keeps reply_count equal to the actual rows across several replies", async () => {
    const actor = await makeActor();
    const threadId = await makeThread(actor);
    for (let i = 0; i < 4; i++) await createReply(db, actor, threadId, BODY, NOW);

    const [row] = await db
      .select({ replyCount: threads.replyCount })
      .from(threads)
      .where(eq(threads.id, threadId));
    const actual = await db.select({ id: posts.id }).from(posts).where(eq(posts.threadId, threadId));

    assert.equal(row.replyCount, actual.length);
    assert.equal(row.replyCount, 4);
  });

  it("refuses replies to a missing thread", async () => {
    const actor = await makeActor();
    const r = await createReply(db, actor, 999_999, BODY, NOW);
    assert.equal(r.ok === false && r.issue, "thread_not_found");
  });
});

describe("locked threads", () => {
  it("blocks a member but allows a moderator", async () => {
    const author = await makeActor();
    const threadId = await makeThread(author);
    await db.update(threads).set({ status: "locked" }).where(eq(threads.id, threadId));

    const blocked = await createReply(db, author, threadId, BODY, NOW);
    assert.equal(blocked.ok === false && blocked.issue, "thread_locked");

    const mod = await makeActor("moderator");
    const allowed = await createReply(db, mod, threadId, BODY, NOW);
    assert.equal(allowed.ok, true, "moderators act through the lock");
  });
});

describe("editPost", () => {
  it("records the previous body as a revision", async () => {
    const actor = await makeActor();
    const threadId = await makeThread(actor);
    const reply = await createReply(db, actor, threadId, "The original text of this reply.", NOW);
    assert.equal(reply.ok, true);
    if (!reply.ok) return;

    const r = await editPost(db, actor, reply.postId, "The revised text of this reply.", NOW);
    assert.equal(r.ok, true);

    const [post] = await db
      .select({ body: posts.body, editedAt: posts.editedAt, editCount: posts.editCount })
      .from(posts)
      .where(eq(posts.id, reply.postId));
    assert.equal(post.body, "The revised text of this reply.");
    assert.notEqual(post.editedAt, null);
    assert.equal(post.editCount, 1);

    const revisions = await db
      .select({ previousBody: postRevisions.previousBody })
      .from(postRevisions)
      .where(eq(postRevisions.postId, reply.postId));
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].previousBody, "The original text of this reply.");
  });

  it("stops another member editing someone else's reply", async () => {
    const author = await makeActor();
    const stranger = await makeActor();
    const threadId = await makeThread(author);
    const reply = await createReply(db, author, threadId, BODY, NOW);
    if (!reply.ok) return;

    await assert.rejects(
      () => editPost(db, stranger, reply.postId, "Hijacked content here.", NOW),
      ForbiddenError,
    );
  });

  it("lets a moderator edit any reply", async () => {
    const author = await makeActor();
    const mod = await makeActor("moderator");
    const threadId = await makeThread(author);
    const reply = await createReply(db, author, threadId, BODY, NOW);
    if (!reply.ok) return;

    const r = await editPost(db, mod, reply.postId, "Moderated content here.", NOW);
    assert.equal(r.ok, true);
  });
});

describe("deletePost", () => {
  it("soft-deletes and decrements the counter", async () => {
    const actor = await makeActor();
    const threadId = await makeThread(actor);
    const reply = await createReply(db, actor, threadId, BODY, NOW);
    if (!reply.ok) return;

    await deletePost(db, actor, reply.postId, NOW);

    const [post] = await db
      .select({ isDeleted: posts.isDeleted, body: posts.body })
      .from(posts)
      .where(eq(posts.id, reply.postId));
    assert.equal(post.isDeleted, true);
    assert.equal(post.body, BODY, "row is retained so moderators can review it");

    const [thread] = await db
      .select({ replyCount: threads.replyCount })
      .from(threads)
      .where(eq(threads.id, threadId));
    assert.equal(thread.replyCount, 0);
  });

  it("never drives the counter negative", async () => {
    const actor = await makeActor();
    const threadId = await makeThread(actor);
    const reply = await createReply(db, actor, threadId, BODY, NOW);
    if (!reply.ok) return;

    await deletePost(db, actor, reply.postId, NOW);
    const second = await deletePost(db, actor, reply.postId, NOW);
    assert.equal(second.ok === false && second.issue, "post_not_found");

    const [thread] = await db
      .select({ replyCount: threads.replyCount })
      .from(threads)
      .where(eq(threads.id, threadId));
    assert.equal(thread.replyCount, 0);
  });
});

describe("castVote", () => {
  it("refuses guests and unverified members", async () => {
    const threadId = await makeThread(await makeActor());
    await assert.rejects(() => castVote(db, GUEST_ACTOR, "thread", threadId, 1, NOW), ForbiddenError);

    const unverified = await makeActor("member", { verified: false });
    await assert.rejects(() => castVote(db, unverified, "thread", threadId, 1, NOW), ForbiddenError);
  });

  it("adds, toggles off, and flips", async () => {
    const actor = await makeActor();
    const voter = await makeActor();
    const threadId = await makeThread(actor);

    const up = await castVote(db, voter, "thread", threadId, 1, NOW);
    assert.deepEqual(up, { score: 1, userVote: 1 });

    // Same vote again clears it.
    const off = await castVote(db, voter, "thread", threadId, 1, NOW);
    assert.deepEqual(off, { score: 0, userVote: 0 });

    // Down, then flip to up: a flip is worth two points.
    const down = await castVote(db, voter, "thread", threadId, -1, NOW);
    assert.deepEqual(down, { score: -1, userVote: -1 });
    const flipped = await castVote(db, voter, "thread", threadId, 1, NOW);
    assert.deepEqual(flipped, { score: 1, userVote: 1 });
  });

  it("keeps vote_score equal to the sum of vote rows", async () => {
    const author = await makeActor();
    const threadId = await makeThread(author);
    const voters = await Promise.all([makeActor(), makeActor(), makeActor()]);

    await castVote(db, voters[0], "thread", threadId, 1, NOW);
    await castVote(db, voters[1], "thread", threadId, 1, NOW);
    await castVote(db, voters[2], "thread", threadId, -1, NOW);

    const [row] = await db
      .select({ score: threads.voteScore })
      .from(threads)
      .where(eq(threads.id, threadId));
    assert.equal(row.score, 1, "1 + 1 - 1");
  });

  it("scores replies independently of their thread", async () => {
    const actor = await makeActor();
    const voter = await makeActor();
    const threadId = await makeThread(actor);
    const reply = await createReply(db, actor, threadId, BODY, NOW);
    if (!reply.ok) return;

    await castVote(db, voter, "post", reply.postId, 1, NOW);

    const [post] = await db.select({ score: posts.voteScore }).from(posts).where(eq(posts.id, reply.postId));
    const [thread] = await db.select({ score: threads.voteScore }).from(threads).where(eq(threads.id, threadId));
    assert.equal(post.score, 1);
    assert.equal(thread.score, 0, "voting a reply must not move the thread score");
  });
});

describe("getUserVotes", () => {
  it("returns only the caller's votes", async () => {
    const author = await makeActor();
    const mine = await makeActor();
    const theirs = await makeActor();
    const a = await makeThread(author);
    const b = await makeThread(author);

    await castVote(db, mine, "thread", a, 1, NOW);
    await castVote(db, theirs, "thread", b, 1, NOW);

    const map = await getUserVotes(db, mine.id, "thread", [a, b]);
    assert.equal(map.get(a), 1);
    assert.equal(map.has(b), false);
  });

  it("is empty for a signed-out caller", async () => {
    const map = await getUserVotes(db, "", "thread", [1, 2, 3]);
    assert.equal(map.size, 0);
  });
});

/**
 * Counters are derived from the rows they summarise rather than adjusted by a
 * delta, because the app runs on Neon's HTTP driver where a mutation and its
 * counter update are separate, untransacted round trips. These tests corrupt a
 * counter first and assert the next write repairs it — under an increment or
 * decrement they would compound the corruption instead, so they fail against a
 * delta implementation.
 */
describe("counters are self-repairing", () => {
  it("recomputes reply_count on reply rather than incrementing drift", async () => {
    const author = await makeActor();
    const threadId = await makeThread(author);

    await createReply(db, author, threadId, BODY, NOW);

    // Simulate a counter update that was lost to a failed round trip.
    await db.update(threads).set({ replyCount: 99 }).where(eq(threads.id, threadId));

    await createReply(db, author, threadId, BODY, NOW);

    const [row] = await db
      .select({ replyCount: threads.replyCount })
      .from(threads)
      .where(eq(threads.id, threadId));

    // Two real replies. A `+ 1` would have produced 100.
    assert.equal(row.replyCount, 2);
  });

  it("recomputes reply_count on delete rather than decrementing drift", async () => {
    const author = await makeActor();
    const threadId = await makeThread(author);

    const first = await createReply(db, author, threadId, BODY, NOW);
    await createReply(db, author, threadId, BODY, NOW);
    assert.ok(first.ok);

    await db.update(threads).set({ replyCount: 0 }).where(eq(threads.id, threadId));

    await deletePost(db, author, first.postId, NOW);

    const [row] = await db
      .select({ replyCount: threads.replyCount })
      .from(threads)
      .where(eq(threads.id, threadId));

    // One reply survives. A `greatest(0 - 1, 0)` would have floored at 0.
    assert.equal(row.replyCount, 1);
  });

  it("does not count soft-deleted replies", async () => {
    const author = await makeActor();
    const threadId = await makeThread(author);

    const a = await createReply(db, author, threadId, BODY, NOW);
    await createReply(db, author, threadId, BODY, NOW);
    assert.ok(a.ok);
    await deletePost(db, author, a.postId, NOW);

    const [row] = await db
      .select({ replyCount: threads.replyCount })
      .from(threads)
      .where(eq(threads.id, threadId));

    assert.equal(row.replyCount, 1);
  });

  it("recomputes vote_score from the votes themselves", async () => {
    const author = await makeActor();
    const voter = await makeActor();
    const other = await makeActor();
    const threadId = await makeThread(author);

    await castVote(db, voter, "thread", threadId, 1, NOW);

    await db.update(threads).set({ voteScore: -50 }).where(eq(threads.id, threadId));

    const result = await castVote(db, other, "thread", threadId, 1, NOW);

    // Two upvotes. A `+ delta` would have returned -49.
    assert.equal(result.score, 2);
  });

  it("recomputes vote_score when a vote is retracted", async () => {
    const author = await makeActor();
    const voter = await makeActor();
    const threadId = await makeThread(author);

    await castVote(db, voter, "thread", threadId, 1, NOW);
    const retracted = await castVote(db, voter, "thread", threadId, 1, NOW);

    assert.equal(retracted.score, 0);
    assert.equal(retracted.userVote, 0);
  });

  it("scores a flipped vote from the stored rows, not a doubled delta", async () => {
    const author = await makeActor();
    const voter = await makeActor();
    const threadId = await makeThread(author);

    await castVote(db, voter, "thread", threadId, 1, NOW);
    const flipped = await castVote(db, voter, "thread", threadId, -1, NOW);

    assert.equal(flipped.score, -1);
    assert.equal(flipped.userVote, -1);
  });

  it("keeps thread and post scores independent for the same id", async () => {
    // thread 1 and post 1 are different targets; the enum discriminates them.
    const author = await makeActor();
    const voter = await makeActor();
    const threadId = await makeThread(author);
    const reply = await createReply(db, author, threadId, BODY, NOW);
    assert.ok(reply.ok);

    await castVote(db, voter, "thread", threadId, 1, NOW);
    const postScore = await castVote(db, voter, "post", reply.postId, -1, NOW);

    const [row] = await db
      .select({ voteScore: threads.voteScore })
      .from(threads)
      .where(eq(threads.id, threadId));

    assert.equal(row.voteScore, 1);
    assert.equal(postScore.score, -1);
  });
});
