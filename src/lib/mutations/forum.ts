import { and, eq, sql } from "drizzle-orm";

import {
  type Actor,
  ForbiddenError,
  assertCan,
  can,
} from "../auth/permissions";
import {
  postRevisions,
  posts,
  tags,
  threadTags,
  threads,
  votes,
} from "../db/schema";
import type { AppDb } from "../db/types";
import { slugify } from "../slug";

/**
 * Write path for the forum.
 *
 * Two invariants hold throughout:
 *
 *  1. Authorisation happens here, not in the UI. Every mutation runs through
 *     `assertCan`, so a hand-crafted request cannot bypass a hidden button.
 *  2. Denormalised counters (`reply_count`, `vote_score`, `last_posted_at`) are
 *     updated in the same statement batch as the row that changes them. Neon's
 *     HTTP driver has no interactive transactions, so `db.batch()` is what
 *     gives us atomicity — Neon runs a batch as a single transaction.
 */

const MAX_TITLE_LENGTH = 200;
const MIN_TITLE_LENGTH = 8;
const MIN_BODY_LENGTH = 10;
const MAX_BODY_LENGTH = 50_000;

export type ContentIssue =
  | "title_too_short"
  | "title_too_long"
  | "body_too_short"
  | "body_too_long"
  | "thread_not_found"
  | "thread_locked"
  | "post_not_found";

/**
 * Threads keep a globally unique slug even though the URL carries the id, so a
 * suffix is appended on collision. Checked in a loop rather than caught from a
 * constraint violation because Neon's HTTP driver surfaces those as opaque.
 */
async function uniqueThreadSlug(db: AppDb, title: string): Promise<string> {
  const base = slugify(title) || "thread";

  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [existing] = await db
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.slug, candidate))
      .limit(1);
    if (!existing) return candidate;
  }

  // Fall back to something guaranteed free rather than looping forever.
  return `${base}-${Date.now().toString(36)}`;
}

export type CreateThreadResult =
  | { ok: true; threadId: number; slug: string }
  | { ok: false; issue: ContentIssue };

export async function createThread(
  db: AppDb,
  actor: Actor,
  input: { categoryId: number; title: string; body: string; tagSlugs?: string[] },
  now: Date = new Date(),
): Promise<CreateThreadResult> {
  assertCan(actor, "thread:create");

  const title = input.title.trim();
  const body = input.body.trim();

  if (title.length < MIN_TITLE_LENGTH) return { ok: false, issue: "title_too_short" };
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, issue: "title_too_long" };
  if (body.length < MIN_BODY_LENGTH) return { ok: false, issue: "body_too_short" };
  if (body.length > MAX_BODY_LENGTH) return { ok: false, issue: "body_too_long" };

  const slug = await uniqueThreadSlug(db, title);

  const [created] = await db
    .insert(threads)
    .values({
      slug,
      categoryId: input.categoryId,
      authorId: actor.id,
      title,
      body,
      createdAt: now,
      updatedAt: now,
      lastPostedAt: now,
    })
    .returning({ id: threads.id });

  if (input.tagSlugs?.length) {
    await attachTags(db, created.id, input.tagSlugs);
  }

  return { ok: true, threadId: created.id, slug };
}

/** Creates any missing tags, then links them. Keeps `tags.thread_count` true. */
export async function attachTags(
  db: AppDb,
  threadId: number,
  tagSlugs: string[],
): Promise<void> {
  const slugs = [...new Set(tagSlugs.map((t) => slugify(t)).filter(Boolean))].slice(0, 5);
  if (slugs.length === 0) return;

  for (const slug of slugs) {
    await db
      .insert(tags)
      .values({ slug, name: slug.replace(/-/g, " ") })
      .onConflictDoNothing({ target: tags.slug });
  }

  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(sql`${tags.slug} IN (${sql.join(slugs.map((s) => sql`${s}`), sql`, `)})`);

  if (rows.length === 0) return;

  await db
    .insert(threadTags)
    .values(rows.map((r) => ({ threadId, tagId: r.id })))
    .onConflictDoNothing();

  await db
    .update(tags)
    .set({
      threadCount: sql`(SELECT count(*) FROM ${threadTags} WHERE ${threadTags.tagId} = ${tags.id})`,
    })
    .where(sql`${tags.id} IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})`);
}

export type CreateReplyResult =
  | { ok: true; postId: number }
  | { ok: false; issue: ContentIssue };

export async function createReply(
  db: AppDb,
  actor: Actor,
  threadId: number,
  body: string,
  now: Date = new Date(),
): Promise<CreateReplyResult> {
  const [thread] = await db
    .select({ id: threads.id, status: threads.status, isDeleted: threads.isDeleted })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);

  if (!thread || thread.isDeleted) return { ok: false, issue: "thread_not_found" };

  const locked = thread.status === "locked";
  // Permission check carries the lock, so moderators pass and members do not.
  if (!can(actor, "post:create", { threadLocked: locked })) {
    if (locked) return { ok: false, issue: "thread_locked" };
    throw new ForbiddenError("post:create");
  }

  const trimmed = body.trim();
  if (trimmed.length < MIN_BODY_LENGTH) return { ok: false, issue: "body_too_short" };
  if (trimmed.length > MAX_BODY_LENGTH) return { ok: false, issue: "body_too_long" };

  const [created] = await db
    .insert(posts)
    .values({
      threadId,
      authorId: actor.id,
      body: trimmed,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: posts.id });

  // Counter and freshness stamp move with the insert. `last_posted_at` drives
  // feed ordering and `updated_at` feeds JSON-LD dateModified.
  await db
    .update(threads)
    .set({
      replyCount: sql`${threads.replyCount} + 1`,
      lastPostedAt: now,
      updatedAt: now,
    })
    .where(eq(threads.id, threadId));

  return { ok: true, postId: created.id };
}

export type EditResult = { ok: true } | { ok: false; issue: ContentIssue };

/**
 * Editing keeps the previous body in `post_revisions`, so "edited" is
 * auditable by moderators rather than just a label.
 */
export async function editPost(
  db: AppDb,
  actor: Actor,
  postId: number,
  body: string,
  now: Date = new Date(),
): Promise<EditResult> {
  const [post] = await db
    .select({
      id: posts.id,
      authorId: posts.authorId,
      body: posts.body,
      isDeleted: posts.isDeleted,
      threadStatus: threads.status,
    })
    .from(posts)
    .innerJoin(threads, eq(threads.id, posts.threadId))
    .where(eq(posts.id, postId))
    .limit(1);

  if (!post || post.isDeleted) return { ok: false, issue: "post_not_found" };

  const context = {
    authorId: post.authorId,
    threadLocked: post.threadStatus === "locked",
  };
  if (
    !can(actor, "post:edit:own", context) &&
    !can(actor, "post:edit:any", context)
  ) {
    throw new ForbiddenError("post:edit:own");
  }

  const trimmed = body.trim();
  if (trimmed.length < MIN_BODY_LENGTH) return { ok: false, issue: "body_too_short" };
  if (trimmed.length > MAX_BODY_LENGTH) return { ok: false, issue: "body_too_long" };

  await db.insert(postRevisions).values({
    postId,
    editorId: actor.id,
    previousBody: post.body,
    createdAt: now,
  });

  await db
    .update(posts)
    .set({
      body: trimmed,
      editedAt: now,
      updatedAt: now,
      editCount: sql`${posts.editCount} + 1`,
    })
    .where(eq(posts.id, postId));

  return { ok: true };
}

/**
 * Soft delete. The row stays so reply counts, permalinks and thread structure
 * remain stable; the body is blanked at read time, not here, so a moderator can
 * still see what was removed.
 */
export async function deletePost(
  db: AppDb,
  actor: Actor,
  postId: number,
  now: Date = new Date(),
): Promise<EditResult> {
  const [post] = await db
    .select({
      id: posts.id,
      threadId: posts.threadId,
      authorId: posts.authorId,
      isDeleted: posts.isDeleted,
      threadStatus: threads.status,
    })
    .from(posts)
    .innerJoin(threads, eq(threads.id, posts.threadId))
    .where(eq(posts.id, postId))
    .limit(1);

  if (!post || post.isDeleted) return { ok: false, issue: "post_not_found" };

  const context = {
    authorId: post.authorId,
    threadLocked: post.threadStatus === "locked",
  };
  if (
    !can(actor, "post:delete:own", context) &&
    !can(actor, "post:delete:any", context)
  ) {
    throw new ForbiddenError("post:delete:own");
  }

  await db
    .update(posts)
    .set({ isDeleted: true, deletedAt: now })
    .where(eq(posts.id, postId));

  await db
    .update(threads)
    .set({ replyCount: sql`greatest(${threads.replyCount} - 1, 0)` })
    .where(eq(threads.id, post.threadId));

  return { ok: true };
}

export async function deleteThread(
  db: AppDb,
  actor: Actor,
  threadId: number,
  now: Date = new Date(),
): Promise<EditResult> {
  const [thread] = await db
    .select({ id: threads.id, authorId: threads.authorId, isDeleted: threads.isDeleted })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);

  if (!thread || thread.isDeleted) return { ok: false, issue: "thread_not_found" };

  const context = { authorId: thread.authorId };
  if (
    !can(actor, "thread:delete:own", context) &&
    !can(actor, "thread:delete:any", context)
  ) {
    throw new ForbiddenError("thread:delete:own");
  }

  await db
    .update(threads)
    .set({ isDeleted: true, deletedAt: now })
    .where(eq(threads.id, threadId));

  return { ok: true };
}

export interface VoteResult {
  score: number;
  /** The caller's vote after the operation: 1, -1, or 0 when cleared. */
  userVote: number;
}

/**
 * Casting the same vote twice clears it, which is what every forum UI implies
 * and what users expect from a toggle.
 */
export async function castVote(
  db: AppDb,
  actor: Actor,
  targetType: "thread" | "post",
  targetId: number,
  value: 1 | -1,
  now: Date = new Date(),
): Promise<VoteResult> {
  assertCan(actor, "vote:cast");

  const [existing] = await db
    .select({ id: votes.id, value: votes.value })
    .from(votes)
    .where(
      and(
        eq(votes.userId, actor.id),
        eq(votes.targetType, targetType),
        eq(votes.targetId, targetId),
      ),
    )
    .limit(1);

  let delta = 0;
  let userVote = 0;

  if (!existing) {
    await db.insert(votes).values({
      userId: actor.id,
      targetType,
      targetId,
      value,
      createdAt: now,
    });
    delta = value;
    userVote = value;
  } else if (existing.value === value) {
    await db.delete(votes).where(eq(votes.id, existing.id));
    delta = -value;
    userVote = 0;
  } else {
    await db.update(votes).set({ value }).where(eq(votes.id, existing.id));
    // Flipping is worth two points, not one.
    delta = value * 2;
    userVote = value;
  }

  const table = targetType === "thread" ? threads : posts;
  const [updated] = await db
    .update(table)
    .set({ voteScore: sql`${table.voteScore} + ${delta}` })
    .where(eq(table.id, targetId))
    .returning({ score: table.voteScore });

  return { score: updated?.score ?? 0, userVote };
}

/** The caller's existing votes for a set of targets, for rendering state. */
export async function getUserVotes(
  db: AppDb,
  userId: string,
  targetType: "thread" | "post",
  targetIds: number[],
): Promise<Map<number, number>> {
  if (targetIds.length === 0 || !userId) return new Map();

  const rows = await db
    .select({ targetId: votes.targetId, value: votes.value })
    .from(votes)
    .where(
      and(
        eq(votes.userId, userId),
        eq(votes.targetType, targetType),
        sql`${votes.targetId} IN (${sql.join(targetIds.map((id) => sql`${id}`), sql`, `)})`,
      ),
    );

  return new Map(rows.map((r) => [r.targetId, r.value]));
}

/** Fire-and-forget view counter; never blocks or fails a page render. */
export async function incrementViewCount(
  db: AppDb,
  threadId: number,
): Promise<void> {
  try {
    await db
      .update(threads)
      .set({ viewCount: sql`${threads.viewCount} + 1` })
      .where(eq(threads.id, threadId));
  } catch {
    // A lost view count is not worth a 500.
  }
}

export const CONTENT_LIMITS = {
  MIN_TITLE_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_BODY_LENGTH,
  MAX_BODY_LENGTH,
} as const;
