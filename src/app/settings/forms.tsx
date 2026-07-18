"use client";

import { useActionState } from "react";

import { Field, FormError, FormNotice, SubmitButton } from "@/components/ui/form";
import {
  changeEmailAction,
  changePasswordAction,
  updateProfileAction,
  type SettingsState,
} from "./actions";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-raised shadow-elev-0 mb-5 rounded-xl p-6">
      <h2 className="text-md text-text font-semibold tracking-[-0.01em]">{title}</h2>
      {description ? (
        <p className="text-xs text-text-secondary mt-1.5 mb-4 leading-relaxed">
          {description}
        </p>
      ) : (
        <div className="mb-4" />
      )}
      {children}
    </section>
  );
}

export function SettingsForms({
  displayName,
  bio,
  email,
  emailVerified,
}: {
  displayName: string;
  bio: string;
  email: string;
  emailVerified: boolean;
}) {
  const [profileState, profileAction, profilePending] = useActionState<
    SettingsState,
    FormData
  >(updateProfileAction, {});
  const [pwState, pwAction, pwPending] = useActionState<SettingsState, FormData>(
    changePasswordAction,
    {},
  );
  const [emailState, emailAction, emailPending] = useActionState<
    SettingsState,
    FormData
  >(changeEmailAction, {});

  return (
    <>
      <Section title="Profile" description="Shown on your public profile page.">
        <form action={profileAction}>
          <FormError>{profileState.error}</FormError>
          <FormNotice>{profileState.notice}</FormNotice>
          <Field label="Display name" name="displayName" defaultValue={displayName} required />
          <label className="mb-4 block">
            <span className="text-sm text-text mb-1.5 block font-medium">Bio</span>
            <textarea
              name="bio"
              rows={3}
              defaultValue={bio}
              maxLength={500}
              className="bg-bg text-text placeholder:text-text-tertiary focus:ring-accent w-full resize-none rounded-md px-3 py-2.5 text-base outline-none focus:ring-2"
            />
          </label>
          <SubmitButton pending={profilePending}>Save profile</SubmitButton>
        </form>
      </Section>

      <Section
        title="Email address"
        description={
          emailVerified
            ? `Currently ${email}. Changing it requires confirming the new address.`
            : `Currently ${email} — not yet confirmed.`
        }
      >
        <form action={emailAction}>
          <FormError>{emailState.error}</FormError>
          <FormNotice>{emailState.notice}</FormNotice>
          <Field label="New email" name="newEmail" type="email" autoComplete="email" required />
          <Field
            label="Current password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <SubmitButton pending={emailPending}>Change email</SubmitButton>
        </form>
      </Section>

      <Section
        title="Password"
        description="Changing your password signs you out everywhere, including here."
      >
        <form action={pwAction}>
          <FormError>{pwState.error}</FormError>
          <FormNotice>{pwState.notice}</FormNotice>
          <Field
            label="Current password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
          <Field
            label="New password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            hint="At least 10 characters."
          />
          <Field
            label="Confirm new password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
          <SubmitButton pending={pwPending}>Change password</SubmitButton>
        </form>
      </Section>
    </>
  );
}
