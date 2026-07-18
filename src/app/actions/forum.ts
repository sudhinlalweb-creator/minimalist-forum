"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getActor } from "@/lib/auth/current-user";
import { ForbiddenError, can } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db";
import {
  CONTENT_LIMITS,
  castVote,
  createReply,
  createThread,
} from "@/lib/mutations/forum";
import { getThreadById } from "@/lib/queries/forum";
import { threadPath } from "@/lib/slug";

export interface ForumFormState {
  error?: string;
}

const ISSUE_MESSAGES: Record<string, string> = {
  title_too_short: `Titles need at least ${CONTENT_LIMITS.MIN_TITLE_LENGTH} characters.`,
  title_too_long: `Titles are limited to ${CONTENT_LIMITS.MAX_TITLE_LENGTH} characters.`,
  body_too_short: `Please write at least ${CONTENT_LIMITS.MIN_BODY_LENGTH} characters.`,
  body_too_long: "That's too long to post in one go.",
  thread_not_found: "That thread no longer exists.",
  thread_locked: "This thread is locked, so it isn't accepting replies.",
  post_not_found: "That reply no longer exists.",
};

export async function createThreadAction(
  _prev: ForumFormState,
  formData: FormData,
): Promise<ForumFormState> {
  const actor = await getActor();
  if (!can(actor, "thread:create")) {
    return {
      error: actor.id
        ? "Confirm your email address before posting."
        : "Sign in to start a thread.",
    };
  }

  const db = await getDb();
  const categoryId = Number(formData.get("categoryId"));
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) {
    return { error: "Pick a category." };
  }

  const tagSlugs = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const result = await createThread(db, actor, {
    categoryId,
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    tagSlugs,
  });

  if (!result.ok) return { error: ISSUE_MESSAGES[result.issue] ?? "Couldn't post that." };

  const thread = await getThreadById(db, result.threadId);
  if (!thread) return { error: "Couldn't post that." };

  const path = threadPath(thread.categorySlug, thread.slug, thread.id);

  // Freshness is a ranking signal, so publish invalidates the affected pages
  // immediately rather than waiting out the revalidate window.
  revalidatePath("/");
  revalidatePath(`/c/${thread.categorySlug}`);
  revalidatePath(`/u/${thread.authorUsername}`);

  redirect(path);
}

export async function createReplyAction(
  _prev: ForumFormState,
  formData: FormData,
): Promise<ForumFormState> {
  const actor = await getActor();
  if (!actor.id) return { error: "Sign in to reply." };
  if (!actor.emailVerified) {
    return { error: "Confirm your email address before replying." };
  }

  const threadId = Number(formData.get("threadId"));
  if (!Number.isSafeInteger(threadId)) return { error: "Couldn't post that reply." };

  const db = await getDb();

  let result;
  try {
    result = await createReply(db, actor, threadId, String(formData.get("body") ?? ""));
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: "You can't reply here." };
    throw error;
  }

  if (!result.ok) return { error: ISSUE_MESSAGES[result.issue] ?? "Couldn't post that reply." };

  const thread = await getThreadById(db, threadId);
  if (thread) {
    revalidatePath(threadPath(thread.categorySlug, thread.slug, thread.id));
    revalidatePath(`/c/${thread.categorySlug}`);
    revalidatePath("/");
  }

  return {};
}

export async function voteAction(
  targetType: "thread" | "post",
  targetId: number,
  value: 1 | -1,
): Promise<{ score: number; userVote: number } | { error: string }> {
  const actor = await getActor();
  if (!can(actor, "vote:cast")) {
    return {
      error: actor.id ? "Confirm your email address to vote." : "Sign in to vote.",
    };
  }

  const db = await getDb();
  try {
    return await castVote(db, actor, targetType, targetId, value);
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: "You can't vote here." };
    throw error;
  }
}
