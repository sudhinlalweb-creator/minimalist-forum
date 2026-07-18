import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { ReplyForm } from "@/components/reply-form";
import { SiteHeader } from "@/components/site-header";
import { VoteButton } from "@/components/vote-button";
import { getActor } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { getUserVotes } from "@/lib/mutations/forum";
import { getDb } from "@/lib/db";
import { excerpt, getRelatedThreads, getThreadById } from "@/lib/queries/forum";
import { parseThreadId, threadPath } from "@/lib/slug";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const revalidate = 300;

type Params = { params: Promise<{ category: string; thread: string }> };

async function load(threadSegment: string) {
  const id = parseThreadId(threadSegment);
  if (id === null) return null;
  const db = await getDb();
  return getThreadById(db, id);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { thread: segment } = await params;
  const thread = await load(segment);
  if (!thread) return { title: "Thread not found", robots: { index: false } };

  const canonical = threadPath(thread.categorySlug, thread.slug, thread.id);

  return {
    title: thread.title,
    // Built from the thread's own opening, not a template.
    description: excerpt(thread.body, 155),
    alternates: { canonical },
    openGraph: {
      type: "article",
      title: thread.title,
      description: excerpt(thread.body, 155),
      url: canonical,
      publishedTime: thread.createdAt.toISOString(),
      modifiedTime: thread.updatedAt.toISOString(),
      authors: [`${siteUrl}/u/${thread.authorUsername}`],
    },
    twitter: {
      card: "summary",
      title: thread.title,
      description: excerpt(thread.body, 155),
    },
  };
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function ThreadPage({ params }: Params) {
  const { category: categorySegment, thread: threadSegment } = await params;
  const thread = await load(threadSegment);
  if (!thread) notFound();

  const canonicalPath = threadPath(thread.categorySlug, thread.slug, thread.id);
  const requestedPath = `/c/${categorySegment}/${threadSegment}`;

  // The id is the identity; the slug and category are decoration. If either
  // drifts (thread renamed or moved), redirect permanently to the canonical URL
  // so link equity consolidates instead of splitting across duplicates.
  if (requestedPath !== canonicalPath) permanentRedirect(canonicalPath);

  const db = await getDb();
  const actor = await getActor();
  const [related, threadVotes, postVotes] = await Promise.all([
    getRelatedThreads(db, thread.id, thread.categoryId),
    getUserVotes(db, actor.id, "thread", [thread.id]),
    getUserVotes(db, actor.id, "post", thread.replies.map((r) => r.id)),
  ]);

  const canonicalUrl = `${siteUrl}${canonicalPath}`;
  const visibleReplies = thread.replies.filter((r) => !r.isDeleted);

  const authorRef = (username: string, name: string) => ({
    "@type": "Person" as const,
    name,
    url: `${siteUrl}/u/${username}`,
  });

  const comments = visibleReplies.map((reply) => ({
    "@type": "Comment" as const,
    "@id": `${canonicalUrl}#reply-${reply.id}`,
    text: reply.body,
    datePublished: reply.createdAt.toISOString(),
    author: authorRef(reply.authorUsername, reply.authorName),
    ...(reply.voteScore > 0
      ? {
          interactionStatistic: {
            "@type": "InteractionCounter",
            interactionType: "https://schema.org/LikeAction",
            userInteractionCount: reply.voteScore,
          },
        }
      : {}),
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    "@id": canonicalUrl,
    url: canonicalUrl,
    headline: thread.title,
    articleBody: thread.body,
    datePublished: thread.createdAt.toISOString(),
    dateModified: thread.updatedAt.toISOString(),
    author: authorRef(thread.authorUsername, thread.authorName),
    interactionStatistic: [
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/CommentAction",
        userInteractionCount: thread.replyCount,
      },
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/LikeAction",
        userInteractionCount: thread.voteScore,
      },
    ],
    comment: comments,
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Meridian", item: siteUrl },
        ...(thread.parentCategorySlug
          ? [
              {
                "@type": "ListItem",
                position: 2,
                name: thread.parentCategoryName,
                item: `${siteUrl}/c/${thread.parentCategorySlug}`,
              },
            ]
          : []),
        {
          "@type": "ListItem",
          position: thread.parentCategorySlug ? 3 : 2,
          name: thread.categoryName,
          item: `${siteUrl}/c/${thread.categorySlug}`,
        },
        {
          "@type": "ListItem",
          position: thread.parentCategorySlug ? 4 : 3,
          name: thread.title,
          item: canonicalUrl,
        },
      ],
    },
  };

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />

      <main className="mx-auto max-w-[720px] px-4 pb-16 md:px-7">
        <nav aria-label="Breadcrumb" className="text-xs text-text-secondary mb-4">
          <Link href="/">Meridian</Link>
          <span aria-hidden> / </span>
          {thread.parentCategorySlug ? (
            <>
              <Link href={`/c/${thread.parentCategorySlug}`}>
                {thread.parentCategoryName}
              </Link>
              <span aria-hidden> / </span>
            </>
          ) : null}
          <Link href={`/c/${thread.categorySlug}`}>{thread.categoryName}</Link>
        </nav>

        <article className="bg-raised border-border border rounded-xl px-5 py-5 md:px-6">
          <div className="mb-3 flex items-center gap-2.5">
            <Avatar name={thread.authorUsername} size={26} />
            <Link
              href={`/u/${thread.authorUsername}`}
              className="text-sm text-text font-medium hover:underline"
            >
              {thread.authorName}
            </Link>
            <time
              dateTime={thread.createdAt.toISOString()}
              className="text-xs text-text-secondary"
            >
              {formatDate(thread.createdAt)}
            </time>
            {thread.isLocked ? (
              <span className="text-2xs text-text-tertiary font-medium">Locked</span>
            ) : null}
          </div>

          {/* The only h1 on the page. Replies are not bumped to h2 — they are
              not sub-topics, and inflating them would muddy the outline. */}
          <h1 className="text-lg text-text mb-2.5 font-bold tracking-[-0.015em]">
            {thread.title}
          </h1>

          <div className="text-base text-comment-text leading-[1.75] whitespace-pre-line">
            {thread.body}
          </div>
        </article>

        <div className="mt-3 flex items-center gap-3 px-1">
          <VoteButton
            targetType="thread"
            targetId={thread.id}
            initialScore={thread.voteScore}
            initialVote={threadVotes.get(thread.id) ?? 0}
          />
          <p className="text-xs text-text-secondary">
            {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}
          </p>
        </div>

        <div className="mt-3 flex flex-col gap-3.5">
          {thread.replies.map((reply) => (
            <article
              key={reply.id}
              id={`reply-${reply.id}`}
              className="bg-raised border-border border rounded-xl px-4 py-4 md:px-5"
            >
              {reply.isDeleted ? (
                <p className="text-sm text-text-tertiary italic">
                  This reply was removed.
                </p>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-2.5">
                    <Avatar name={reply.authorUsername} size={26} />
                    <Link
                      href={`/u/${reply.authorUsername}`}
                      className="text-sm text-text font-medium hover:underline"
                    >
                      {reply.authorName}
                    </Link>
                    <time
                      dateTime={reply.createdAt.toISOString()}
                      className="text-xs text-text-secondary"
                    >
                      {formatDate(reply.createdAt)}
                    </time>
                    {reply.editedAt ? (
                      <span className="text-2xs text-text-tertiary">edited</span>
                    ) : null}
                  </div>
                  <div className="text-base text-comment-text leading-[1.7] whitespace-pre-line">
                    {reply.body}
                  </div>
                  <div className="mt-2.5 -ml-2">
                    <VoteButton
                      targetType="post"
                      targetId={reply.id}
                      initialScore={reply.voteScore}
                      initialVote={postVotes.get(reply.id) ?? 0}
                    />
                  </div>
                </>
              )}
            </article>
          ))}
        </div>

        {can(actor, "post:create", { threadLocked: thread.isLocked }) ? (
          <ReplyForm threadId={thread.id} />
        ) : (
          <p className="text-sm text-text-secondary bg-raised border-border border mt-5 rounded-xl px-5 py-4">
            {thread.isLocked
              ? "This thread is locked and isn't accepting replies."
              : !actor.id
                ? <><Link href="/login">Sign in</Link> to reply to this thread.</>
                : "Confirm your email address to reply."}
          </p>
        )}

        {related.length > 0 ? (
          <aside className="mt-10">
            <h2 className="text-xs text-text-secondary mb-3 font-semibold tracking-[0.05em] uppercase">
              Related threads
            </h2>
            <ul className="flex flex-col gap-1">
              {related.map((r) => (
                <li key={r.id}>
                  <Link
                    href={threadPath(r.categorySlug, r.slug, r.id)}
                    className="text-sm hover:bg-hover-bg -mx-2 block rounded-md px-2 py-1.5"
                  >
                    {r.title}
                    <span className="text-xs text-text-secondary">
                      {" "}
                      · {r.replyCount} {r.replyCount === 1 ? "reply" : "replies"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </main>
    </div>
  );
}
