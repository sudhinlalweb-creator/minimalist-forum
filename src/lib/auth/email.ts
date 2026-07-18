/**
 * Outbound auth email.
 *
 * Behind a narrow interface so swapping the console transport for Resend (or
 * anything else) is a one-line change at the composition root, not an edit to
 * every call site.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Dev transport: prints the message, and the link on its own line so it can be
 * clicked or copied straight out of the terminal.
 */
export const consoleMailer: Mailer = {
  async send({ to, subject, text }) {
    const rule = "─".repeat(64);
    process.stdout.write(
      `\n${rule}\n✉  ${subject}\n   to: ${to}\n${rule}\n${text}\n${rule}\n\n`,
    );
  },
};

/** Collects messages instead of sending. Used by tests. */
export function createMemoryMailer(): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

let configured: Mailer | null = null;

/** Override the transport (composition root, tests). */
export function setMailer(mailer: Mailer | null): void {
  configured = mailer;
}

export function getMailer(): Mailer {
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    // Failing loudly beats silently dropping verification email in production.
    throw new Error(
      "No mailer configured. Wire a real transport (e.g. Resend) via setMailer() before deploying.",
    );
  }

  return consoleMailer;
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}

export function verificationUrl(email: string, token: string): string {
  const url = new URL("/verify-email", siteUrl());
  url.searchParams.set("email", email);
  url.searchParams.set("token", token);
  return url.toString();
}

export function passwordResetUrl(email: string, token: string): string {
  const url = new URL("/reset-password", siteUrl());
  url.searchParams.set("email", email);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function sendVerificationEmail(
  email: string,
  token: string,
  mailer: Mailer = getMailer(),
): Promise<void> {
  await mailer.send({
    to: email,
    subject: "Confirm your email address",
    text: [
      "Welcome to Meridian.",
      "",
      "Confirm your email address to start posting:",
      verificationUrl(email, token),
      "",
      "This link expires in 24 hours. If you did not sign up, ignore this email.",
    ].join("\n"),
  });
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  mailer: Mailer = getMailer(),
): Promise<void> {
  await mailer.send({
    to: email,
    subject: "Reset your password",
    text: [
      "Someone asked to reset the password for this account.",
      "",
      "Set a new password:",
      passwordResetUrl(email, token),
      "",
      "This link expires in 1 hour and can be used once.",
      "If this wasn't you, ignore this email — your password will not change.",
    ].join("\n"),
  });
}
