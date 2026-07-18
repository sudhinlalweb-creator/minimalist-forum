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
import { forgotPasswordAction, type FormState } from "../actions";

export function ForgotPasswordForm({ footer }: { footer: ReactNode }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    forgotPasswordAction,
    {},
  );

  if (state.notice) {
    return (
      <FormCard title="Check your email" footer={footer}>
        <FormNotice>{state.notice}</FormNotice>
      </FormCard>
    );
  }

  return (
    <FormCard
      title="Reset your password"
      description="Enter your email address and we'll send you a link to set a new password."
      footer={footer}
    >
      <form action={action} noValidate>
        <FormError>{state.error}</FormError>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <SubmitButton pending={pending}>Send reset link</SubmitButton>
      </form>
    </FormCard>
  );
}
