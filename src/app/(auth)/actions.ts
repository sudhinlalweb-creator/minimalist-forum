"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { signIn } from "@/auth";
import {
  registerUser,
  requestPasswordReset,
  resetPassword,
} from "@/lib/auth/accounts";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import {
  type RateLimitedAction,
  checkRateLimit,
  clearAttempts,
  recordAttempt,
} from "@/lib/auth/rate-limit";
import { getDb } from "@/lib/db";

export interface FormState {
  error?: string;
  notice?: string;
}

/**
 * Best-effort client address for rate limiting. Behind Vercel this is set by
 * the platform; locally it is usually absent, in which case only the
 * per-account bucket applies.
 */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip");
}

function tooManyMessage(retryAfter: Date | null): string {
  if (!retryAfter) return "Too many attempts. Please try again later.";
  const minutes = Math.max(
    1,
    Math.ceil((retryAfter.getTime() - Date.now()) / 60_000),
  );
  return `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

async function guard(
  action: RateLimitedAction,
  identifier: string | null,
): Promise<{ ip: string | null; blocked: string | null }> {
  const db = await getDb();
  const ip = await clientIp();
  const verdict = await checkRateLimit(db, action, { identifier, ip });
  return {
    ip,
    blocked: verdict.allowed ? null : tooManyMessage(verdict.retryAfter),
  };
}

const VALIDATION_MESSAGES: Record<string, string> = {
  email_invalid: "That doesn't look like a valid email address.",
  username_invalid:
    "Usernames must be 3–30 characters, using letters, numbers, hyphens or underscores.",
  username_reserved: "That username is reserved. Please choose another.",
  username_taken: "That username is already taken.",
  password_too_short: `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`,
};

export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  const { ip, blocked } = await guard("register", email);
  if (blocked) return { error: blocked };

  const db = await getDb();
  await recordAttempt(db, "register", { identifier: email, ip });

  const result = await registerUser(db, { email, username, password });
  if (!result.ok) {
    return { error: VALIDATION_MESSAGES[result.issue] ?? "Please check your details." };
  }

  // Deliberately identical whether or not the address was already registered.
  return {
    notice:
      "Check your email for a confirmation link. In development it is printed to the terminal running the dev server.",
  };
}

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const { ip, blocked } = await guard("login", email);
  if (blocked) return { error: blocked };

  const db = await getDb();

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      await recordAttempt(db, "login", { identifier: email, ip });
      // One message for every failure, so the form is not an account oracle.
      return {
        error:
          "Incorrect email or password, or the address hasn't been confirmed yet.",
      };
    }
    throw error;
  }

  // Successful sign-in should not leave the user's quota depleted.
  await clearAttempts(db, "login", { identifier: email, ip });
  redirect("/");
}

export async function forgotPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "");

  const { ip, blocked } = await guard("password_reset_request", email);
  if (blocked) return { error: blocked };

  const db = await getDb();
  await recordAttempt(db, "password_reset_request", { identifier: email, ip });
  await requestPasswordReset(db, email);

  // Always the same response, whether or not the account exists.
  return {
    notice:
      "If an account exists for that address, a reset link is on its way. In development it is printed to the terminal.",
  };
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password !== confirm) return { error: "Those passwords don't match." };

  const db = await getDb();
  const result = await resetPassword(db, email, token, password);

  if (!result.ok) {
    switch (result.reason) {
      case "password_too_short":
        return { error: VALIDATION_MESSAGES.password_too_short };
      case "expired_token":
        return { error: "That reset link has expired. Please request a new one." };
      default:
        return { error: "That reset link is not valid. Please request a new one." };
    }
  }

  redirect("/login?reset=1");
}
