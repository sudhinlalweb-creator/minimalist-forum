/**
 * Local dev seed. Content mirrors the demo data in the Claude Design project
 * (Forum.dc.html) so UI work in Phase 3 renders against realistic copy —
 * same categories, threads, authors and replies as the prototype.
 *
 * Run with: npm run db:seed
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  categories,
  posts,
  tags,
  threadTags,
  threads,
  users,
  votes,
} from "./schema";
import * as schema from "./schema";
import { slugify } from "../slug";

/** Structural type so the seed runs against Neon or PGlite alike. */
type SeedDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const CATEGORIES = [
  {
    slug: "product",
    name: "Product",
    description: "Roadmap, feedback and release discussion.",
    intro:
      "Where product direction gets argued out in the open — what we're building next, why, and what we decided against. Start here if you want context behind a shipped change.",
    subs: [
      { slug: "roadmap", name: "Roadmap", description: "What's planned and why." },
      { slug: "feedback", name: "Feedback", description: "Requests and friction reports." },
      { slug: "releases", name: "Releases", description: "Changelogs and rollout notes." },
    ],
  },
  {
    slug: "design",
    name: "Design",
    description: "Systems, critique and interface craft.",
    intro:
      "Interface craft at the level of individual decisions: type ramps, elevation, motion, and the tradeoffs behind them. Critique threads are expected to show the work, not just the outcome.",
    subs: [
      { slug: "systems", name: "Systems", description: "Tokens, components, consistency." },
      { slug: "critique", name: "Critique", description: "Work in progress, reviewed." },
    ],
  },
  {
    slug: "engineering",
    name: "Engineering",
    description: "Infrastructure, performance and RFCs.",
    intro:
      "Implementation detail and architectural argument. RFCs land here before they land in code, and performance threads are expected to carry measurements rather than intuitions.",
    subs: [
      { slug: "infra", name: "Infra", description: "Platform and deployment." },
      { slug: "perf", name: "Performance", description: "Measurements and regressions." },
      { slug: "rfcs", name: "RFCs", description: "Proposals under review." },
    ],
  },
  {
    slug: "general",
    name: "General",
    description: "Everything that doesn't fit elsewhere.",
    intro:
      "Broader conversation about how we work and think — essays, questions, and the threads that don't belong to a single discipline.",
    subs: [],
  },
  {
    slug: "help",
    name: "Help & Support",
    description: "Questions that need an answer.",
    intro:
      "Question-and-answer threads. Mark the reply that solved it as the accepted answer so the next person searching finds it first.",
    subs: [],
  },
] as const;

const USERS = [
  { username: "dana", name: "Dana Okafor", bio: "Product, mostly. Interested in how power users actually learn interfaces." },
  { username: "marco", name: "Marco Lindqvist", bio: "Design systems. Currently thinking about elevation as information." },
  { username: "priya", name: "Priya Ramesh", bio: "Frontend infrastructure. Measure first." },
  { username: "theo", name: "Theo Brandt", bio: "Writing about design more than doing it lately." },
  { username: "sam", name: "Sam Wu", bio: null },
  { username: "elena", name: "Elena Petrova", bio: null },
  { username: "chidi", name: "Chidi Nwosu", bio: null },
  { username: "anna", name: "Anna Kowalski", bio: null },
  { username: "ola", name: "Ola Bello", bio: null },
] as const;

const THREADS = [
  {
    category: "product",
    author: "dana",
    title: "Should keyboard shortcuts be discoverable by default?",
    body: "We keep hiding the shortcut overlay behind a modifier key. Curious if anyone has data on discoverability vs. clutter for power-user features. My instinct is a slim hint in the corner that fades after first use, but I want to hear counterarguments before we commit.",
    tags: ["keyboard-shortcuts", "onboarding", "power-users"],
    hoursAgo: 2,
    replies: [
      { author: "sam", hoursAgo: 1, body: "A one-time contextual hint on first launch, then gone for good, seems like the right tradeoff. Anything persistent starts to feel like chrome." },
      { author: "elena", hoursAgo: 0.8, body: "Agreed, though I would keep it reachable from a single \"?\" affordance somewhere quiet, for the users who dismiss it too fast." },
    ],
  },
  {
    category: "design",
    author: "marco",
    title: "Shadow depth as a signal instead of badges",
    body: "Tried mapping reply count to elevation instead of a number badge. Early read: it feels calmer, but does it read as intentional or accidental at a glance? Screens attached in the design channel — happy to walk through the ramp we used for shadow blur and opacity.",
    tags: ["elevation", "design-systems", "visual-hierarchy"],
    hoursAgo: 5,
    replies: [
      { author: "chidi", hoursAgo: 4, body: "This is the kind of detail that only a handful of people notice consciously, but everyone feels. Ship it." },
      { author: "anna", hoursAgo: 3, body: "Slight risk of the busiest threads looking \"heavier\" in a way that reads as noisy rather than active. Worth a cap on the ramp." },
      { author: "marco", hoursAgo: 2, body: "Good call — we capped it at three steps for exactly that reason. Past a certain reply count it plateaus." },
    ],
  },
  {
    category: "engineering",
    author: "priya",
    title: "Migrating the thread renderer off virtualized lists",
    body: "Virtualization was solving a problem we no longer have at our current thread sizes. Proposing we simplify and re-measure before optimizing further. Happy to pair on the migration plan if others are interested — should be a net simplification.",
    tags: ["performance", "rendering", "refactoring"],
    hoursAgo: 24,
    replies: [
      { author: "ola", hoursAgo: 20, body: "Measured this last quarter too — virtualization overhead was costing more than it saved below ~500 nodes." },
    ],
  },
  {
    category: "general",
    author: "theo",
    title: "What \"minimal\" has stopped meaning to me",
    body: "Minimal used to mean fewer elements. Lately it means fewer decisions the user has to make to understand what matters. Different goal, different tools. Curious how others think about this distinction when reviewing designs.",
    tags: ["minimalism", "design-philosophy"],
    hoursAgo: 48,
    replies: [],
  },
] as const;

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

export async function seed(db: SeedDb) {
  console.log("Resetting forum tables…");
  // TRUNCATE ... CASCADE resets identity sequences so seeded ids are stable
  // across runs. Auth tables are included: seeded users own seeded content.
  await db.execute(sql`
    TRUNCATE TABLE
      votes, reports, moderation_actions, post_revisions,
      thread_tags, tags, posts, threads, categories,
      accounts, sessions, verification_tokens, users
    RESTART IDENTITY CASCADE
  `);

  console.log("Seeding users…");
  const insertedUsers = await db
    .insert(users)
    .values(
      USERS.map((u, i) => ({
        username: u.username,
        name: u.name,
        email: `${u.username}@example.com`,
        emailVerified: hoursAgo(24 * 30),
        bio: u.bio,
        // No passwordHash: credentials auth lands in Phase 2, which will add a
        // dev-login path rather than baking a hash into the seed.
        role: (i === 0 ? "admin" : i === 1 ? "moderator" : "member") as
          | "admin"
          | "moderator"
          | "member",
        createdAt: hoursAgo(24 * 30),
        lastActiveAt: hoursAgo(1),
      })),
    )
    .returning({ id: users.id, username: users.username });

  const userByUsername = new Map(insertedUsers.map((u) => [u.username, u.id]));

  console.log("Seeding categories…");
  const categoryIdBySlug = new Map<string, number>();

  for (const [i, cat] of CATEGORIES.entries()) {
    const [row] = await db
      .insert(categories)
      .values({
        slug: cat.slug,
        name: cat.name,
        description: cat.description,
        introMarkdown: cat.intro,
        sortOrder: i,
      })
      .returning({ id: categories.id });
    categoryIdBySlug.set(cat.slug, row.id);

    for (const [j, sub] of cat.subs.entries()) {
      const [subRow] = await db
        .insert(categories)
        .values({
          slug: sub.slug,
          name: sub.name,
          description: sub.description,
          parentId: row.id,
          sortOrder: j,
        })
        .returning({ id: categories.id });
      categoryIdBySlug.set(sub.slug, subRow.id);
    }
  }

  console.log("Seeding tags…");
  const uniqueTags = [...new Set(THREADS.flatMap((t) => t.tags))];
  const insertedTags = await db
    .insert(tags)
    .values(
      uniqueTags.map((slug) => ({
        slug,
        name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      })),
    )
    .returning({ id: tags.id, slug: tags.slug });
  const tagIdBySlug = new Map(insertedTags.map((t) => [t.slug, t.id]));

  console.log("Seeding threads, replies and votes…");
  for (const t of THREADS) {
    const authorId = userByUsername.get(t.author)!;
    const createdAt = hoursAgo(t.hoursAgo);
    const lastReply = t.replies.at(-1);

    // Derive the denormalised score from the votes actually inserted below.
    // Inventing a number here would let a counter-sync bug in Phase 3 pass
    // unnoticed, since seeded data would already disagree with the vote rows.
    const voters = insertedUsers.slice(
      0,
      Math.min(2 + t.replies.length, insertedUsers.length),
    );

    const [thread] = await db
      .insert(threads)
      .values({
        slug: slugify(t.title),
        categoryId: categoryIdBySlug.get(t.category)!,
        authorId,
        title: t.title,
        body: t.body,
        replyCount: t.replies.length,
        voteScore: voters.length,
        viewCount: t.replies.length * 47 + 31,
        createdAt,
        updatedAt: createdAt,
        lastPostedAt: lastReply ? hoursAgo(lastReply.hoursAgo) : createdAt,
      })
      .returning({ id: threads.id });

    await db.insert(threadTags).values(
      t.tags.map((slug) => ({ threadId: thread.id, tagId: tagIdBySlug.get(slug)! })),
    );

    for (const r of t.replies) {
      const replyAt = hoursAgo(r.hoursAgo);
      await db.insert(posts).values({
        threadId: thread.id,
        authorId: userByUsername.get(r.author)!,
        body: r.body,
        createdAt: replyAt,
        updatedAt: replyAt,
      });
    }

    await db.insert(votes).values(
      voters.map((v) => ({
        userId: v.id,
        targetType: "thread" as const,
        targetId: thread.id,
        value: 1,
      })),
    );
  }

  await db
    .update(tags)
    .set({ threadCount: sql`(SELECT count(*) FROM thread_tags WHERE thread_tags.tag_id = tags.id)` });

  console.log(
    `Done: ${USERS.length} users, ${categoryIdBySlug.size} categories, ${THREADS.length} threads, ${uniqueTags.length} tags.`,
  );
}

async function main() {
  if (process.env.DATABASE_URL) {
    const { getDb } = await import("./index");
    await seed((await getDb()) as unknown as SeedDb);
    return;
  }

  console.warn(
    "[db:seed] No DATABASE_URL — using local PGlite at .pglite for script-only seeding.",
  );
  const { createDevDb } = await import("./dev");
  await seed((await createDevDb(".pglite")) as unknown as SeedDb);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
