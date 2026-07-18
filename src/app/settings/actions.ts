"use server";

import { revalidatePath } from "next/cache";

import { getSessionUser } from "@/lib/auth/current-user";
import {
  MAX_BIO_LENGTH,
  changeEmail,
  changePassword,
  updateProfile,
} from "@/lib/auth/accounts";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { getDb } from "@/lib/db";

export interface SettingsState {
  error?: string;
  notice?: string;
}

export async function updateProfileAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await getSessionUser();
  if (!user) return { error: "You need to be signed in." };

  const db = await getDb();
  const result = await updateProfile(db, user.id, {
    displayName: String(formData.get("displayName") ?? ""),
    bio: String(formData.get("bio") ?? ""),
  });

  if (!result.ok) {
    return {
      error:
        result.reason === "bio_too_long"
          ? `Bios are limited to ${MAX_BIO_LENGTH} characters.`
          : "Display name can't be empty.",
    };
  }

  // The profile page is statically revalidated, so nudge it immediately.
  revalidatePath(`/u/${user.username}`);
  return { notice: "Profile updated." };
}

export async function changePasswordAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await getSessionUser();
  if (!user) return { error: "You need to be signed in." };

  const next = String(formData.get("newPassword") ?? "");
  if (next !== String(formData.get("confirmPassword") ?? "")) {
    return { error: "Those passwords don't match." };
  }

  const db = await getDb();
  const result = await changePassword(
    db,
    user.id,
    String(formData.get("currentPassword") ?? ""),
    next,
  );

  if (!result.ok) {
    return {
      error:
        result.reason === "password_too_short"
          ? `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`
          : "That current password isn't right.",
    };
  }

  // sessionsValidAfter has moved past this session's token too, so the user is
  // about to be signed out everywhere — say so rather than letting it surprise.
  return {
    notice:
      "Password changed. You've been signed out on every device, including this one — sign in again to continue.",
  };
}

export async function changeEmailAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await getSessionUser();
  if (!user) return { error: "You need to be signed in." };

  const db = await getDb();
  const result = await changeEmail(
    db,
    user.id,
    String(formData.get("password") ?? ""),
    String(formData.get("newEmail") ?? ""),
  );

  if (!result.ok) {
    const messages: Record<string, string> = {
      wrong_password: "That password isn't right.",
      email_invalid: "That doesn't look like a valid email address.",
      email_taken: "That address is already in use.",
      no_such_user: "Account not found.",
    };
    return { error: messages[result.reason] ?? "Couldn't change your email." };
  }

  return {
    notice:
      "Check the new address for a confirmation link. Until you confirm it, you won't be able to post.",
  };
}
