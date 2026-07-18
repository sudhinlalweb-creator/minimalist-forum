"use client";

import { useState, useTransition } from "react";

import { voteAction } from "@/app/actions/forum";

/**
 * The only interactive island on a thread page. Kept deliberately small: the
 * public pages must stay light on client JS, so voting ships as a single
 * button rather than pulling the whole thread into a client component.
 */
export function VoteButton({
  targetType,
  targetId,
  initialScore,
  initialVote,
}: {
  targetType: "thread" | "post";
  targetId: number;
  initialScore: number;
  initialVote: number;
}) {
  const [score, setScore] = useState(initialScore);
  const [vote, setVote] = useState(initialVote);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const active = vote === 1;

  function onClick() {
    setMessage(null);
    startTransition(async () => {
      const result = await voteAction(targetType, targetId, 1);
      if ("error" in result) {
        setMessage(result.error);
        return;
      }
      setScore(result.score);
      setVote(result.userVote);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-pressed={active}
        aria-label={active ? "Remove upvote" : "Upvote"}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
          active ? "text-accent-text font-medium" : "text-text-secondary hover:bg-hover-bg"
        }`}
      >
        <span aria-hidden>▲</span>
        <span className="tabular-nums">{score}</span>
      </button>
      {message ? (
        <span role="alert" className="text-2xs text-text-tertiary">
          {message}
        </span>
      ) : null}
    </span>
  );
}
