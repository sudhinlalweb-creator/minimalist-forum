"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

import {
  Field,
  FormCard,
  FormError,
  FormNotice,
  SubmitButton,
} from "@/components/ui/form";
import { registerAction, type FormState } from "../actions";

export function RegisterForm({ footer }: { footer: ReactNode }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    registerAction,
    {},
  );

  // On success the form is replaced by the notice: there is nothing left to do
  // on this page until the user opens the emailed link.
  if (state.notice) {
    return (
      <FormCard title="Check your email" footer={footer}>
        <FormNotice>{state.notice}</FormNotice>
      </FormCard>
    );
  }

  return (
    <FormCard
      title="Create an account"
      description="You'll need to confirm your email address before you can post."
      footer={footer}
    >
      <form action={action} noValidate>
        <FormError>{state.error}</FormError>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          required
          hint="Shown publicly at /u/your-name. 3–30 characters."
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 10 characters."
        />
        <SubmitButton pending={pending}>Create account</SubmitButton>
      </form>
    </FormCard>
  );
}
