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
import { loginAction, type FormState } from "../actions";

export function LoginForm({
  footer,
  initialNotice,
}: {
  footer: ReactNode;
  initialNotice?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    loginAction,
    {},
  );

  return (
    <FormCard title="Sign in" footer={footer}>
      <form action={action} noValidate>
        <FormError>{state.error}</FormError>
        <FormNotice>{state.notice ?? initialNotice}</FormNotice>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </form>
    </FormCard>
  );
}
