import { and, desc, eq, sql } from "drizzle-orm";

import { categories, posts, threads, users } from "../db/schema";
import type { AppDb } from "../db/types";

/**
 * Public profile data for /u/[username].
 *
 * Profiles with real activity are indexable content, so this returns enough to
 * render a substantive page — counts plus recent threads — rather than a stub
 * that a crawler would treat as thin.
 */

export interface ProfileThread {
  id: number;
  slug: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  replyCount: number;
  voteScore: number;
  createdAt: Date;
}

export interface Profile {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  image: string | null;
  role: "member" | "moderator" | "admin";
  createdAt: Date;
  threadCount: number;
  postCount: number;
  recentThreads: ProfileThread[];
}

/**
 * Returns null for unknown, deleted, or banned users so the route can 404.
 * Banned accounts are hidden rather than tombstoned: leaving them indexable
 * would preserve exactly the content moderation removed.
 */
export async function getProfileByUsername(
  db: AppDb,
  username: string,
): Promise<Profile | null> {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      bio: users.bio,
      image: users.image,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      and(
        eq(sql`lower(${users.username})`, username.toLowerCase()),
        eq(users.isDeleted, false),
        eq(users.isBanned, false),
      ),
    )
    .limit(1);

  if (!user) return null;

  const [[threadCountRow], [postCountRow], recentThreads] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(threads)
      .where(and(eq(threads.authorId, user.id), eq(threads.isDeleted, false))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(eq(posts.authorId, user.id), eq(posts.isDeleted, false))),
    db
      .select({
        id: threads.id,
        slug: threads.slug,
        title: threads.title,
        categorySlug: categories.slug,
        categoryName: categories.name,
        replyCount: threads.replyCount,
        voteScore: threads.voteScore,
        createdAt: threads.createdAt,
      })
      .from(threads)
      .innerJoin(categories, eq(categories.id, threads.categoryId))
      .where(and(eq(threads.authorId, user.id), eq(threads.isDeleted, false)))
      .orderBy(desc(threads.createdAt))
      .limit(20),
  ]);

  return {
    id: user.id,
    username: user.username,
    displayName: user.name ?? user.username,
    bio: user.bio,
    image: user.image,
    role: user.role,
    createdAt: user.createdAt,
    threadCount: threadCountRow?.n ?? 0,
    postCount: postCountRow?.n ?? 0,
    recentThreads,
  };
}
