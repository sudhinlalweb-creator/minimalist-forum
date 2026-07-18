import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { POST } from "./route";

const env = process.env as Record<string, string | undefined>;
const ORIGINAL_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete env.CRON_SECRET;
  else env.CRON_SECRET = ORIGINAL_SECRET;
});

function post(authorization?: string): Promise<Response> {
  return POST(
    new Request("https://example.com/api/cron/purge-attempts", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
  );
}

/**
 * These cover the gate only. Reaching the database would need a configured
 * Neon URL, and the authorisation decision is the part worth pinning: this
 * endpoint deletes rows.
 */
describe("purge-attempts authorisation", () => {
  it("is disabled rather than public when no secret is set", async () => {
    delete env.CRON_SECRET;

    const response = await post("Bearer anything");
    assert.equal(response.status, 503);
  });

  it("rejects a missing authorization header", async () => {
    env.CRON_SECRET = "s3cret";

    const response = await post();
    assert.equal(response.status, 401);
  });

  it("rejects a wrong secret", async () => {
    env.CRON_SECRET = "s3cret";

    const response = await post("Bearer wrong");
    assert.equal(response.status, 401);
  });

  it("rejects a correct secret sent without the Bearer scheme", async () => {
    env.CRON_SECRET = "s3cret";

    const response = await post("s3cret");
    assert.equal(response.status, 401);
  });

  it("rejects a secret that merely starts with the right prefix", async () => {
    // Guards against a truncating comparison.
    env.CRON_SECRET = "s3cret";

    const response = await post("Bearer s3cretXXXX");
    assert.equal(response.status, 401);
  });

  it("does not reveal whether the secret was close", async () => {
    env.CRON_SECRET = "s3cret";

    const body = await (await post("Bearer wrong")).json();
    assert.deepEqual(body, { error: "Unauthorized." });
  });
});
