"use client";

import { useActionState } from "react";

import { createThreadAction, type ForumFormState } from "@/app/actions/forum";
import { Field, FormError, FormNotice } from "@/components/ui/form";

export function NewThreadForm({
  categories,
  defaultCategoryId,
  verified,
}: {
  categories: { id: number; label: string }[];
  defaultCategoryId?: number;
  verified: boolean;
}) {
  const [state, action, pending] = useActionState<ForumFormState, FormData>(
    createThreadAction,
    {},
  );

  return (
    <form action={action} className="bg-raised border-border border rounded-xl p-6">
      <FormError>{state.error}</FormError>
      {!verified ? (
        <FormNotice>
          Confirm your email address before posting. Check your inbox for the
          confirmation link.
        </FormNotice>
      ) : null}

      <label className="mb-4 block">
        <span className="text-sm text-text mb-1.5 block font-medium">Category</span>
        <select
          name="categoryId"
          defaultValue={defaultCategoryId}
          className="bg-bg border-border text-text focus:ring-accent w-full rounded-md border px-3 py-2.5 text-base outline-none focus:ring-2"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <Field
        label="Title"
        name="title"
        required
        maxLength={200}
        hint="Write it as a question or a claim — it becomes the page's headline."
      />

      <label className="mb-4 block">
        <span className="text-sm text-text mb-1.5 block font-medium">Body</span>
        <textarea
          name="body"
          rows={10}
          required
          className="bg-bg border-border text-text placeholder:text-text-tertiary focus:ring-accent w-full resize-y rounded-md border px-3 py-2.5 text-base leading-relaxed outline-none focus:ring-2"
        />
      </label>

      <Field
        label="Tags"
        name="tags"
        hint="Comma separated, up to 5. Tags group related threads together."
        placeholder="design-systems, elevation"
      />

      <button
        type="submit"
        disabled={pending || !verified}
        className="bg-accent text-on-accent w-full cursor-pointer rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
      >
        {pending ? "Posting…" : "Post thread"}
      </button>
    </form>
  );
}
