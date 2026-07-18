import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_PASSWORD_BYTES,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password";

describe("hashPassword", () => {
  it("round-trips a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("Correct horse battery staple", hash), false);
    assert.equal(await verifyPassword("", hash), false);
  });

  it("salts: identical passwords produce different hashes", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    assert.notEqual(a, b);
    // …but both still verify.
    assert.equal(await verifyPassword("same-password", a), true);
    assert.equal(await verifyPassword("same-password", b), true);
  });

  it("encodes its parameters in the hash", async () => {
    const hash = await hashPassword("whatever");
    assert.match(hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it("does not truncate long passwords the way bcrypt does", async () => {
    const base = "x".repeat(80);
    const hash = await hashPassword(base + "AAA");
    assert.equal(await verifyPassword(base + "BBB", hash), false);
    assert.equal(await verifyPassword(base + "AAA", hash), true);
  });

  it("handles unicode consistently via NFKC", async () => {
    // Same graphemes, different normalisation forms — written as explicit
    // escapes so the two strings are genuinely different byte sequences.
    const composed = "caf\u00e9-passw\u00f6rd";
    const decomposed = "cafe\u0301-passwo\u0308rd";
    assert.notEqual(composed, decomposed, "test would be vacuous");

    const hash = await hashPassword(composed);
    assert.equal(await verifyPassword(decomposed, hash), true);
  });

  it("refuses absurdly large inputs", async () => {
    await assert.rejects(() => hashPassword("y".repeat(MAX_PASSWORD_BYTES + 1)));
  });

  it("refuses an empty password", async () => {
    await assert.rejects(() => hashPassword(""));
  });
});

describe("verifyPassword hardening", () => {
  it("returns false rather than throwing on malformed hashes", async () => {
    for (const bad of [
      null,
      undefined,
      "",
      "not-a-hash",
      "scrypt$1$2$3",
      "bcrypt$32768$8$1$c2FsdA==$a2V5",
      "scrypt$0$8$1$c2FsdA==$a2V5",
      "scrypt$32768$8$1$$",
      "scrypt$99999999$8$1$c2FsdA==$a2V5", // would allocate absurd memory
    ]) {
      assert.equal(
        await verifyPassword("anything", bad as string | null),
        false,
        `expected false for ${JSON.stringify(bad)}`,
      );
    }
  });

  it("returns false for an oversized candidate instead of throwing", async () => {
    const hash = await hashPassword("real-password");
    assert.equal(
      await verifyPassword("z".repeat(MAX_PASSWORD_BYTES + 1), hash),
      false,
    );
  });
});

describe("needsRehash", () => {
  it("is false for a freshly created hash", async () => {
    assert.equal(needsRehash(await hashPassword("fresh")), false);
  });

  it("is true for weaker stored parameters", () => {
    assert.equal(needsRehash("scrypt$16384$8$1$c2FsdA==$a2V5"), true);
  });

  it("is true for an unparseable hash", () => {
    assert.equal(needsRehash("garbage"), true);
  });
});
