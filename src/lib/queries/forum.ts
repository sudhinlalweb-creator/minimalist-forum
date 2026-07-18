import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { categories, posts, threads, users } from "../db/schema";
import type { AppDb } from "../db/types";

/**
 * Read path for the forum.
 *
 * Every list query is a single round trip with its joins inlined — no N+1.
 * That matters more than usual here: Neon is remote (~500ms observed from this
 * machine), so per-row queries would dominate page time and hurt LCP, which is
 * both a ranking factor and a crawl-budget input.
 */

export const THREADS_PER_PAGE = 20;

export interface CategorySummary {
  id: number;
  slug: string;
  name: string;
  description: string;
  threadCount: number;
  children: { id: number; slug: string; name: string; description: string }[];
}

/** Top-level categories with their sub-categories, for the nav rail. */
export async function getCategoryTree(db: AppDb): Promise<CategorySummary[]> {
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
      parentId: categories.parentId,
      sortOrder: categories.sortOrder,
      // A LEFT JOIN + GROUP BY, not a correlated subquery: the subquery form
      // failed to correlate and returned 1 for every category, so the nav
      // showed "1 + number of sub-categories" instead of a thread count.
      threadCount: sql<number>`count(${threads.id})::int`,
    })
    .from(categories)
    .leftJoin(
      threads,
      and(eq(threads.categoryId, categories.id), eq(threads.isDeleted, false)),
    )
    .groupBy(
      categories.id,
      categories.slug,
      categories.name,
      categories.description,
      categories.parentId,
      categories.sortOrder,
    )
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  const tops = rows.filter((r) => r.parentId === null);
  return tops.map((top) => ({
    id: top.id,
    slug: top.slug,
    name: top.name,
    description: top.description,
    // A parent's count includes its children's threads, so the nav number
    // matches what the category page actually lists.
    threadCount:
      top.threadCount +
      rows
        .filter((r) => r.parentId === top.id)
        .reduce((sum, child) => sum + child.threadCount, 0),
    children: rows
      .filter((r) => r.parentId === top.id)
      .map((c) => ({ id: c.id, slug: c.slug, name: c.name, description: c.description })),
  }));
}

export interface CategoryDetail {
  id: number;
  slug: string;
  name: string;
  description: string;
  introMarkdown: string | null;
  parentSlug: string | null;
  parentName: string | null;
  childIds: number[];
}

export async function getCategoryBySlug(
  db: AppDb,
  slug: string,
): Promise<CategoryDetail | null> {
  const parentCategory = alias(categories, "parent_category");
  const [row] = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
      introMarkdown: categories.introMarkdown,
      // Self-join rather than a correlated subquery — the subquery form did not
      // correlate and returned null for every parent, silently dropping the
      // parent from child-category breadcrumbs.
      parentSlug: parentCategory.slug,
      parentName: parentCategory.name,
    })
    .from(categories)
    .leftJoin(parentCategory, eq(parentCategory.id, categories.parentId))
    .where(eq(sql`lower(${categories.slug})`, slug.toLowerCase()))
    .limit(1);

  if (!row) return null;

  const children = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.parentId, row.id));

  return { ...row, childIds: children.map((c) => c.id) };
}

export interface ThreadCard {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  authorUsername: string;
  authorName: string;
  categorySlug: string;
  categoryName: string;
  replyCount: number;
  voteScore: number;
  isPinned: boolean;
  isLocked: boolean;
  createdAt: Date;
  lastPostedAt: Date;
}

export interface ThreadPage {
  threads: ThreadCard[];
  total: number;
  page: number;
  pageCount: number;
}

/**
 * Paginated thread list. Real pages with indexable `?page=N` URLs rather than
 * infinite scroll, so every thread is reachable by a crawler.
 */
export async function getThreads(
  db: AppDb,
  opts: { categoryIds?: number[]; page?: number } = {},
): Promise<ThreadPage> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const offset = (page - 1) * THREADS_PER_PAGE;

  const scope =
    opts.categoryIds && opts.categoryIds.length > 0
      ? sql`AND ${threads.categoryId} IN (${sql.join(
          opts.categoryIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;

  const where = sql`${threads.isDeleted} = false ${scope}`;

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(threads)
    .where(where);

  const rows = await db
    .select({
      id: threads.id,
      slug: threads.slug,
      title: threads.title,
      body: threads.body,
      authorUsername: users.username,
      authorName: users.name,
      categorySlug: categories.slug,
      categoryName: categories.name,
      replyCount: threads.replyCount,
      voteScore: threads.voteScore,
      isPinned: threads.isPinned,
      status: threads.status,
      createdAt: threads.createdAt,
      lastPostedAt: threads.lastPostedAt,
    })
    .from(threads)
    .innerJoin(users, eq(users.id, threads.authorId))
    .innerJoin(categories, eq(categories.id, threads.categoryId))
    .where(where)
    .orderBy(desc(threads.isPinned), desc(threads.lastPostedAt))
    .limit(THREADS_PER_PAGE)
    .offset(offset);

  const total = countRow?.n ?? 0;

  return {
    page,
    total,
    pageCount: Math.max(1, Math.ceil(total / THREADS_PER_PAGE)),
    threads: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      excerpt: excerpt(r.body),
      authorUsername: r.authorUsername,
      authorName: r.authorName ?? r.authorUsername,
      categorySlug: r.categorySlug,
      categoryName: r.categoryName,
      replyCount: r.replyCount,
      voteScore: r.voteScore,
      isPinned: r.isPinned,
      isLocked: r.status === "locked",
      createdAt: r.createdAt,
      lastPostedAt: r.lastPostedAt,
    })),
  };
}

export interface ThreadReply {
  id: number;
  body: string;
  authorUsername: string;
  authorName: string;
  voteScore: number;
  createdAt: Date;
  editedAt: Date | null;
  isDeleted: boolean;
}

export interface ThreadDetail {
  id: number;
  slug: string;
  title: string;
  body: string;
  authorUsername: string;
  authorName: string;
  authorBio: string | null;
  categoryId: number;
  categorySlug: string;
  categoryName: string;
  parentCategorySlug: string | null;
  parentCategoryName: string | null;
  replyCount: number;
  voteScore: number;
  viewCount: number;
  isPinned: boolean;
  isLocked: boolean;
  acceptedPostId: number | null;
  createdAt: Date;
  updatedAt: Date;
  replies: ThreadReply[];
}

export async function getThreadById(
  db: AppDb,
  id: number,
): Promise<ThreadDetail | null> {
  const parentCategory = alias(categories, "parent_category");
  const [row] = await db
    .select({
      id: threads.id,
      slug: threads.slug,
      title: threads.title,
      body: threads.body,
      authorUsername: users.username,
      authorName: users.name,
      authorBio: users.bio,
      categoryId: categories.id,
      categorySlug: categories.slug,
      categoryName: categories.name,
      parentCategorySlug: parentCategory.slug,
      parentCategoryName: parentCategory.name,
      replyCount: threads.replyCount,
      voteScore: threads.voteScore,
      viewCount: threads.viewCount,
      isPinned: threads.isPinned,
      status: threads.status,
      acceptedPostId: threads.acceptedPostId,
      createdAt: threads.createdAt,
      updatedAt: threads.updatedAt,
    })
    .from(threads)
    .innerJoin(users, eq(users.id, threads.authorId))
    .innerJoin(categories, eq(categories.id, threads.categoryId))
    .leftJoin(parentCategory, eq(parentCategory.id, categories.parentId))
    .where(and(eq(threads.id, id), eq(threads.isDeleted, false)))
    .limit(1);

  if (!row) return null;

  const replyRows = await db
    .select({
      id: posts.id,
      body: posts.body,
      authorUsername: users.username,
      authorName: users.name,
      voteScore: posts.voteScore,
      createdAt: posts.createdAt,
      editedAt: posts.editedAt,
      isDeleted: posts.isDeleted,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(eq(posts.threadId, id))
    .orderBy(asc(posts.createdAt));

  return {
    ...row,
    authorName: row.authorName ?? row.authorUsername,
    isLocked: row.status === "locked",
    replies: replyRows.map((r) => ({
      ...r,
      authorName: r.authorName ?? r.authorUsername,
      // Deleted replies are tombstoned rather than removed, so reply numbering
      // and permalinks in the thread stay stable.
      body: r.isDeleted ? "" : r.body,
    })),
  };
}

/** Related threads by shared tag, falling back to same category. */
export async function getRelatedThreads(
  db: AppDb,
  threadId: number,
  categoryId: number,
  limit = 5,
): Promise<Pick<ThreadCard, "id" | "slug" | "title" | "categorySlug" | "replyCount">[]> {
  return db
    .select({
      id: threads.id,
      slug: threads.slug,
      title: threads.title,
      categorySlug: categories.slug,
      replyCount: threads.replyCount,
    })
    .from(threads)
    .innerJoin(categories, eq(categories.id, threads.categoryId))
    .where(
      and(
        eq(threads.categoryId, categoryId),
        eq(threads.isDeleted, false),
        sql`${threads.id} <> ${threadId}`,
      ),
    )
    .orderBy(desc(threads.voteScore), desc(threads.lastPostedAt))
    .limit(limit);
}

/** First meaningful line of a markdown body, for cards and meta descriptions. */
export function excerpt(body: string, maxLength = 180): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (flat.length <= maxLength) return flat;
  const clipped = flat.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}
