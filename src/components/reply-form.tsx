"use client";

import Link from "next/link";
import { type FormEvent, useActionState, useEffect, useRef, useState } from "react";

import { createReplyAction, type ForumFormState } from "@/app/actions/forum";
import { FormError } from "@/components/ui/form";

/**
 * Guests get the composer rather than a locked door. Writing is the point of
 * the page, and asking someone to authenticate before they know what they
 * want to say is the wrong order — the prompt lands on submit instead.
 *
 * This is presentation only. createReplyAction rejects a signed-out caller
 * server-side regardless of what this renders; `isGuest` exists to explain,
 * never to enforce.
 */
export function ReplyForm({
  threadId,
  isGuest,
}: {
  threadId: number;
  isGuest: boolean;
}) {
  const [state, action, pending] = useActionState<ForumFormState, FormData>(
    createReplyAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const wasPending = useRef(false);
  const [askToSignIn, setAskToSignIn] = useState(false);

  /**
   * A guest who submits has to leave the page to authenticate, and sign-in
   * currently lands them back at the root rather than here. Persisting the
   * draft means the trip costs them their place but not their words.
   */
  const draftKey = `meridian:reply-draft:${threadId}`;

  useEffect(() => {
    const saved = sessionStorage.getItem(draftKey);
    if (saved && bodyRef.current && !bodyRef.current.value) {
      bodyRef.current.value = saved;
    }
  }, [draftKey]);

  // Clear the textarea once a submit completes without an error.
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      formRef.current?.reset();
      sessionStorage.removeItem(draftKey);
    }
    wasPending.current = pending;
  }, [pending, state.error, draftKey]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!isGuest) return;
    // Stop the submit before it reaches the server: the answer is already
    // known, and the round trip would only return the same refusal.
    event.preventDefault();
    sessionStorage.setItem(draftKey, bodyRef.current?.value ?? "");
    setAskToSignIn(true);
  }

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={handleSubmit}
      className="bg-raised border-border border mt-5 rounded-xl px-4 py-4 md:px-5"
    >
      <FormError>{state.error}</FormError>
      <input type="hidden" name="threadId" value={threadId} />
      <label htmlFor="reply-body" className="sr-only">
        Reply to this thread
      </label>
      <textarea
        ref={bodyRef}
        id="reply-body"
        name="body"
        rows={3}
        required
        placeholder="Reply to this thread…"
        className="bg-transparent text-text placeholder:text-text-tertiary w-full resize-none border-none text-base leading-relaxed outline-none"
      />

      {askToSignIn ? (
        <p
          role="status"
          className="text-sm text-text bg-hover-bg border-border-strong mt-2.5 rounded-sm border px-3 py-2 leading-relaxed"
        >
          <Link href="/login" className="font-medium underline">
            Sign in
          </Link>{" "}
          or{" "}
          <Link href="/register" className="font-medium underline">
            create an account
          </Link>{" "}
          to post this. Your reply is saved here in the meantime.
        </p>
      ) : null}

      <div className="mt-2.5 flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-on-accent cursor-pointer rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {pending ? "Posting…" : "Reply"}
        </button>
      </div>
    </form>
  );
}
