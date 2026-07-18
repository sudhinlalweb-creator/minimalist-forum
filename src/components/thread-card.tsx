import Link from "next/link";

import { elevationForReplies, surfaceForReplies } from "@/lib/elevation";
import type { ThreadCard as ThreadCardData } from "@/lib/queries/forum";
import { threadPath } from "@/lib/slug";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Depth signals activity instead of a count badge, per the design
 * ("Depth by shading only"). The whole card is a real anchor, so the thread is
 * crawlable and middle-clickable — the prototype opened threads via client
 * state, which no crawler could follow.
 */
export function ThreadCard({ thread }: { thread: ThreadCardData }) {
  return (
    <article
      className={`rounded-xl ${surfaceForReplies(thread.replyCount)} ${elevationForReplies(thread.replyCount)}`}
    >
      <div className="px-5 py-4.5">
        <div className="mb-2.5 flex items-center gap-2.5">
          <span className="bg-avatar-bg text-avatar-text flex size-6.5 items-center justify-center rounded-md text-xs font-semibold">
            {thread.authorName.charAt(0).toUpperCase()}
          </span>
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
          {thread.isPinned ? (
            <span className="text-2xs text-accent-text font-medium">Pinned</span>
          ) : null}
          {thread.isLocked ? (
            <span className="text-2xs text-text-tertiary font-medium">Locked</span>
          ) : null}
        </div>

        <h2 className="text-md text-text mb-1.5 font-semibold tracking-[-0.01em]">
          <Link href={threadPath(thread.categorySlug, thread.slug, thread.id)}>
            {thread.title}
          </Link>
        </h2>

        <p className="text-sm text-text-secondary mb-3.5 leading-relaxed">
          {thread.excerpt}
        </p>

        <div className="text-xs text-text-secondary flex items-center gap-4">
          <span>
            {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}
          </span>
          <Link href={`/c/${thread.categorySlug}`}>{thread.categoryName}</Link>
        </div>
      </div>
    </article>
  );
}
