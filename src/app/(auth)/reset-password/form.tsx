"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

import {
  Field,
  FormCard,
  FormError,
  SubmitButton,
} from "@/components/ui/form";
import { resetPasswordAction, type FormState } from "../actions";

export function ResetPasswordForm({
  email,
  token,
  footer,
}: {
  email: string;
  token: string;
  footer: ReactNode;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    resetPasswordAction,
    {},
  );

  return (
    <FormCard
      title="Set a new password"
      description={`For ${email}.`}
      footer={footer}
    >
      <form action={action} noValidate>
        <FormError>{state.error}</FormError>
        {/* The token travels with the form so the action needs no session. */}
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="token" value={token} />
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 10 characters."
        />
        <Field
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
        />
        <SubmitButton pending={pending}>Change password</SubmitButton>
      </form>
    </FormCard>
  );
}
