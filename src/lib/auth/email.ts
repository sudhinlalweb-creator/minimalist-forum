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

/**
 * Resend over plain `fetch` rather than the `resend` SDK.
 *
 * The app deploys to a Cloudflare Worker with a 3 MiB gzipped ceiling that a
 * PGlite import has already blown once. This transport is one request against
 * a documented endpoint, so pulling a dependency in to make it would spend
 * bundle budget on nothing.
 *
 * @param from Must be an address on a domain verified in Resend. Resend
 *   rejects unverified senders, so a wrong value here fails every send.
 */
export function createResendMailer(options: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): Mailer {
  const { apiKey, from, fetchImpl = fetch } = options;

  return {
    async send({ to, subject, text }) {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });

      if (!response.ok) {
        // Resend puts the reason in the body; the status alone rarely says
        // enough to tell a bad key from an unverified domain. Nothing here
        // interpolates the key — this message reaches logs.
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Resend rejected the message (HTTP ${response.status})${
            detail ? `: ${detail.slice(0, 300)}` : ""
          }`,
        );
      }
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

  // Resolved per call rather than at module load: on Workers there is no
  // composition root that reliably runs before the first request, and secrets
  // are not guaranteed to be readable at module-init time.
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (apiKey && from) return createResendMailer({ apiKey, from });

  if (process.env.NODE_ENV === "production") {
    // Failing loudly beats silently dropping verification email in production.
    // Naming the missing half matters: setting only one of the two looks
    // configured from the dashboard but sends nothing.
    const missing = [
      apiKey ? null : "RESEND_API_KEY",
      from ? null : "EMAIL_FROM",
    ].filter(Boolean);

    throw new Error(
      `No mailer configured — missing ${missing.join(" and ")}. Set both, or ` +
        "wire a transport via setMailer() before deploying.",
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
