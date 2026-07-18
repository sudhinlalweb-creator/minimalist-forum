import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  consoleMailer,
  createMemoryMailer,
  getMailer,
  passwordResetUrl,
  sendPasswordResetEmail,
  sendVerificationEmail,
  setMailer,
  verificationUrl,
} from "./email";

const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

/** NODE_ENV is declared as a literal union, so widen to write to it. */
const env = process.env as Record<string, string | undefined>;

/**
 * Assigning `undefined` to a process.env key stores the string "undefined"
 * rather than clearing it, which would leave a later `new URL(..., base)`
 * parsing "undefined" as an origin. Delete instead.
 */
function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete env[key];
  else env[key] = value;
}

afterEach(() => {
  setMailer(null);
  restore("NEXT_PUBLIC_SITE_URL", ORIGINAL_SITE_URL);
  restore("NODE_ENV", ORIGINAL_NODE_ENV);
});

describe("link builders", () => {
  it("builds a verification link on the configured origin", () => {
    env.NEXT_PUBLIC_SITE_URL = "https://meridian.example";
    const url = new URL(verificationUrl("dana@example.com", "tok123"));

    assert.equal(url.origin, "https://meridian.example");
    assert.equal(url.pathname, "/verify-email");
    assert.equal(url.searchParams.get("email"), "dana@example.com");
    assert.equal(url.searchParams.get("token"), "tok123");
  });

  it("builds a reset link on the configured origin", () => {
    env.NEXT_PUBLIC_SITE_URL = "https://meridian.example";
    const url = new URL(passwordResetUrl("dana@example.com", "tok123"));

    assert.equal(url.pathname, "/reset-password");
    assert.equal(url.searchParams.get("token"), "tok123");
  });

  it("strips trailing slashes so the path is not doubled", () => {
    env.NEXT_PUBLIC_SITE_URL = "https://meridian.example///";
    assert.ok(verificationUrl("a@b.co", "t").startsWith("https://meridian.example/verify-email"));
  });

  it("falls back to localhost when the origin is unset", () => {
    delete env.NEXT_PUBLIC_SITE_URL;
    assert.ok(verificationUrl("a@b.co", "t").startsWith("http://localhost:3000/"));
  });

  it("percent-encodes addresses that would otherwise break the query", () => {
    env.NEXT_PUBLIC_SITE_URL = "https://meridian.example";
    const raw = "a+tag&x=1@example.com";
    const url = verificationUrl(raw, "t");

    // The raw "&" must not appear as a separator, or it would inject a param.
    assert.ok(!url.includes("&x=1@"));
    // ...and it must survive the round trip intact.
    assert.equal(new URL(url).searchParams.get("email"), raw);
  });

  it("percent-encodes tokens containing URL-significant characters", () => {
    env.NEXT_PUBLIC_SITE_URL = "https://meridian.example";
    const token = "a/b+c=d&e";
    assert.equal(new URL(passwordResetUrl("a@b.co", token)).searchParams.get("token"), token);
  });
});

describe("transport selection", () => {
  it("uses the console transport in development", () => {
    env.NODE_ENV = "development";
    assert.equal(getMailer(), consoleMailer);
  });

  it("refuses to fall back to console in production", () => {
    // Silently dropping verification mail in production would leave every new
    // account permanently unable to post.
    env.NODE_ENV = "production";
    assert.throws(() => getMailer(), /No mailer configured/);
  });

  it("uses an explicitly configured transport in production", () => {
    env.NODE_ENV = "production";
    const mailer = createMemoryMailer();
    setMailer(mailer);
    assert.equal(getMailer(), mailer);
  });

  it("reverts to the default once the override is cleared", () => {
    env.NODE_ENV = "development";
    setMailer(createMemoryMailer());
    setMailer(null);
    assert.equal(getMailer(), consoleMailer);
  });
});

describe("outbound messages", () => {
  it("sends verification mail to the address, carrying the link", async () => {
    env.NEXT_PUBLIC_SITE_URL = "https://meridian.example";
    const mailer = createMemoryMailer();

    await sendVerificationEmail("dana@example.com", "tok123", mailer);

    assert.equal(mailer.sent.length, 1);
    const [message] = mailer.sent;
    assert.equal(message.to, "dana@example.com");
    assert.ok(message.text.includes(verificationUrl("dana@example.com", "tok123")));
  });

  it("sends reset mail carrying the reset link, not the verification one", async () => {
    env.NEXT_PUBLIC_SITE_URL = "https://meridian.example";
    const mailer = createMemoryMailer();

    await sendPasswordResetEmail("dana@example.com", "tok123", mailer);

    const [message] = mailer.sent;
    assert.ok(message.text.includes("/reset-password"));
    assert.ok(!message.text.includes("/verify-email"));
  });

  it("tells the recipient what to do if they did not request it", async () => {
    // Both mails are triggerable by a third party who knows the address, so
    // each has to say that ignoring it is safe.
    const mailer = createMemoryMailer();
    await sendVerificationEmail("a@b.co", "t", mailer);
    await sendPasswordResetEmail("a@b.co", "t", mailer);

    for (const message of mailer.sent) {
      assert.match(message.text, /ignore this email/i);
    }
  });

  it("routes through the configured transport when none is passed", async () => {
    const mailer = createMemoryMailer();
    setMailer(mailer);

    await sendVerificationEmail("a@b.co", "t");

    assert.equal(mailer.sent.length, 1);
  });
});
