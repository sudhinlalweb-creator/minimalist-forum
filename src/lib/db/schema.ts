import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

/**
 * Postgres `tsvector`, used for the generated full-text search column on
 * threads. Drizzle has no native tsvector type, so we declare it here.
 */
const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/* -------------------------------------------------------------------------- */
/*  Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const userRole = pgEnum("user_role", [
  "member",
  "moderator",
  "admin",
]);

/**
 * `pinned` is deliberately NOT a status. The brief modelled status as
 * open|locked|pinned, but a thread can be both pinned and locked, so pinning
 * is a separate boolean on `threads`. Flagged in the Phase 1 audit.
 */
export const threadStatus = pgEnum("thread_status", ["open", "locked"]);

export const targetType = pgEnum("target_type", ["thread", "post"]);

export const reportStatus = pgEnum("report_status", [
  "open",
  "reviewing",
  "resolved",
  "dismissed",
]);

/* -------------------------------------------------------------------------- */
/*  Auth.js core tables                                                        */
/*                                                                             */
/*  Column names here (name, image, emailVerified) are dictated by             */
/*  @auth/drizzle-adapter and cannot be renamed without a custom adapter, so   */
/*  they diverge from the brief's display_name / avatar_url / email_verified_at.*/
/*  Forum-specific columns are appended to the same table.                     */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  "users",
  {
    // DB-level default, not Drizzle's $defaultFn: the latter only applies to
    // inserts made through Drizzle, leaving raw SQL (seeds, backfills, psql)
    // to fail on NOT NULL. gen_random_uuid() is built in on Postgres 13+.
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),

    // Auth.js contract
    name: text("name"), // display name
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { mode: "date" }),
    image: text("image"), // avatar url

    // Forum extensions
    username: text("username").notNull(), // public profile slug: /u/[username]
    passwordHash: text("password_hash"), // null for OAuth-only accounts
    bio: text("bio"),
    role: userRole("role").notNull().default("member"),
    isBanned: boolean("is_banned").notNull().default(false),
    bannedReason: text("banned_reason"),

    /**
     * Any session token issued before this instant is rejected. Auth.js forces
     * the JWT strategy when the Credentials provider is used (see
     * @auth/core assert.js: "Signing in with credentials only supported if JWT
     * strategy is enabled"), so we cannot delete session rows to revoke access.
     * Bumping this timestamp on password change, forced logout, or ban gives
     * the same instant-revocation guarantee the brief asked DB sessions for.
     */
    sessionsValidAfter: timestamp("sessions_valid_after", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    // Soft delete — retains authored content attribution per the brief's
    // "soft delete + data retention policy note".
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_email_key").on(sql`lower(${t.email})`),
    uniqueIndex("users_username_key").on(sql`lower(${t.username})`),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("accounts_user_id_idx").on(t.userId),
  ],
);

/**
 * Database-backed sessions (not JWT) so a ban or password reset revokes
 * access immediately, per the brief's recommendation.
 */
export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/**
 * Rate-limit ledger: one row per attempt, counted over a sliding window.
 *
 * Deliberately in Postgres rather than in-process memory, which does not
 * survive across serverless instances, and rather than Redis, which would add
 * a service dependency for what is a low-volume path. Revisit if auth traffic
 * ever justifies it — `checkRateLimit` is the only caller.
 */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    /** Namespaced bucket, e.g. `login:ip:1.2.3.4` or `login:user:a@b.com`. */
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("auth_attempts_key_created_at_idx").on(t.key, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/*  Forum content                                                              */
/* -------------------------------------------------------------------------- */

export const categories = pgTable(
  "categories",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),

    /** Short line under the nav item. */
    description: text("description").notNull(),
    /**
     * Longer hub intro copy rendered above the thread list. AI answer engines
     * favour pages that summarise a topic before linking out (spec §4).
     */
    introMarkdown: text("intro_markdown"),

    /** Self-reference gives us the design's two-level nav (Product > Roadmap). */
    parentId: integer("parent_id").references((): AnyPgColumn => categories.id),

    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("categories_parent_id_idx").on(t.parentId)],
);

export const threads = pgTable(
  "threads",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    /**
     * Globally unique, not per-category: the canonical URL is
     * /c/[category]/[slug]-[id], and a stable slug means moving a thread
     * between categories does not orphan inbound links.
     */
    slug: text("slug").notNull().unique(),

    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),

    title: text("title").notNull(),
    body: text("body").notNull(), // markdown

    status: threadStatus("status").notNull().default("open"),
    isPinned: boolean("is_pinned").notNull().default(false),

    /** Denormalised counters — read on every feed card, too hot to join for. */
    replyCount: integer("reply_count").notNull().default(0),
    voteScore: integer("vote_score").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),

    /**
     * Set when a reply is marked as the accepted answer. Drives the QAPage /
     * acceptedAnswer JSON-LD in Phase 4. Nullable: most threads are
     * discussions, not questions.
     */
    acceptedPostId: integer("accepted_post_id"),

    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Feeds <time datetime> and JSON-LD dateModified — a freshness signal. */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastPostedAt: timestamp("last_posted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')`,
    ),
  },
  (t) => [
    index("threads_category_id_idx").on(t.categoryId),
    index("threads_author_id_idx").on(t.authorId),
    // Feed ordering: newest-first within a category, pinned on top.
    index("threads_feed_idx").on(t.categoryId, t.isPinned, t.lastPostedAt),
    index("threads_search_idx").using("gin", t.searchVector),
  ],
);

export const posts = pgTable(
  "posts",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),

    body: text("body").notNull(), // markdown

    /**
     * Replies render FLAT (see Phase 1 audit note). This column is retained
     * nullable so a quote/reply-to affordance can be added later without a
     * migration, but nothing reads it as a nesting tree today.
     */
    parentPostId: integer("parent_post_id"),

    voteScore: integer("vote_score").notNull().default(0),

    /** Non-null once edited — renders the "edited" marker. */
    editedAt: timestamp("edited_at", { withTimezone: true }),
    editCount: integer("edit_count").notNull().default(0),

    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Thread page reads every post in creation order — this covers it.
    index("posts_thread_id_created_at_idx").on(t.threadId, t.createdAt),
    index("posts_author_id_idx").on(t.authorId),
  ],
);

/** Append-only edit history, so "edited" is auditable by moderators. */
export const postRevisions = pgTable(
  "post_revisions",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    editorId: text("editor_id")
      .notNull()
      .references(() => users.id),
    /** The body as it was BEFORE this edit. */
    previousBody: text("previous_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("post_revisions_post_id_idx").on(t.postId)],
);

/* -------------------------------------------------------------------------- */
/*  Tags                                                                       */
/* -------------------------------------------------------------------------- */

export const tags = pgTable("tags", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Intro copy for the /tag/[slug] hub page — topical-authority surface. */
  description: text("description"),
  threadCount: integer("thread_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const threadTags = pgTable(
  "thread_tags",
  {
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.tagId] }),
    // Drives tag hub pages and the "related threads" module.
    index("thread_tags_tag_id_idx").on(t.tagId),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Votes & moderation                                                         */
/* -------------------------------------------------------------------------- */

export const votes = pgTable(
  "votes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: targetType("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    /** Upvote/downvote only — the check constraint keeps it to +1 / -1. */
    value: smallint("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("votes_user_target_key").on(
      t.userId,
      t.targetType,
      t.targetId,
    ),
    index("votes_target_idx").on(t.targetType, t.targetId),
    check("votes_value_check", sql`${t.value} IN (-1, 1)`),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: targetType("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    reason: text("reason").notNull(),
    status: reportStatus("status").notNull().default("open"),

    resolvedById: text("resolved_by_id").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Moderation queue reads open reports oldest-first.
    index("reports_status_created_at_idx").on(t.status, t.createdAt),
    index("reports_target_idx").on(t.targetType, t.targetId),
  ],
);

/** Audit trail for moderator actions — required for an accountable mod team. */
export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(), // lock | pin | move | delete | ban | ...
    targetType: targetType("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("moderation_actions_created_at_idx").on(t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/*  Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type Vote = typeof votes.$inferSelect;
export type Report = typeof reports.$inferSelect;
