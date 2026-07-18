"use client";

import { useActionState, useEffect, useRef } from "react";

import { createReplyAction, type ForumFormState } from "@/app/actions/forum";
import { FormError } from "@/components/ui/form";

export function ReplyForm({ threadId }: { threadId: number }) {
  const [state, action, pending] = useActionState<ForumFormState, FormData>(
    createReplyAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  // Clear the textarea once a submit completes without an error.
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) formRef.current?.reset();
    wasPending.current = pending;
  }, [pending, state.error]);

  return (
    <form
      ref={formRef}
      action={action}
      className="bg-raised border-border border mt-5 rounded-xl px-4 py-4 md:px-5"
    >
      <FormError>{state.error}</FormError>
      <input type="hidden" name="threadId" value={threadId} />
      <label htmlFor="reply-body" className="sr-only">
        Reply to this thread
      </label>
      <textarea
        id="reply-body"
        name="body"
        rows={3}
        required
        placeholder="Reply to this thread…"
        className="bg-transparent text-text placeholder:text-text-tertiary w-full resize-none border-none text-base leading-relaxed outline-none"
      />
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
