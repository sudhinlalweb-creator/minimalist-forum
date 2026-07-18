import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type Actor,
  GUEST_ACTOR,
  can,
  hasRolePermission,
  permissionsFor,
} from "./permissions";

const verified = new Date("2026-01-01");

const member: Actor = { id: "u1", role: "member", emailVerified: verified };
const otherMember: Actor = { id: "u2", role: "member", emailVerified: verified };
const moderator: Actor = { id: "m1", role: "moderator", emailVerified: verified };
const admin: Actor = { id: "a1", role: "admin", emailVerified: verified };

describe("guests", () => {
  it("can read", () => {
    assert.equal(can(GUEST_ACTOR, "content:read"), true);
  });

  it("cannot post, vote or report", () => {
    assert.equal(can(GUEST_ACTOR, "thread:create"), false);
    assert.equal(can(GUEST_ACTOR, "post:create"), false);
    assert.equal(can(GUEST_ACTOR, "vote:cast"), false);
    assert.equal(can(GUEST_ACTOR, "report:create"), false);
  });
});

describe("ownership", () => {
  it("lets a member edit their own post but not someone else's", () => {
    assert.equal(can(member, "post:edit:own", { authorId: "u1" }), true);
    assert.equal(can(member, "post:edit:own", { authorId: "u2" }), false);
  });

  it("denies :own when no author is supplied", () => {
    assert.equal(can(member, "post:edit:own", {}), false);
  });

  it("does not grant members the :any escape hatch", () => {
    assert.equal(can(member, "post:edit:any", { authorId: "u2" }), false);
    assert.equal(can(otherMember, "thread:delete:any"), false);
  });
});

describe("role inheritance", () => {
  it("gives moderators every member permission", () => {
    for (const p of permissionsFor("member")) {
      assert.equal(hasRolePermission("moderator", p), true, `moderator missing ${p}`);
    }
  });

  it("gives admins every moderator permission", () => {
    for (const p of permissionsFor("moderator")) {
      assert.equal(hasRolePermission("admin", p), true, `admin missing ${p}`);
    }
  });

  it("does not leak admin permissions down to moderators", () => {
    assert.equal(hasRolePermission("moderator", "role:assign"), false);
    assert.equal(hasRolePermission("moderator", "category:manage"), false);
    assert.equal(hasRolePermission("admin", "role:assign"), true);
  });
});

describe("banned users", () => {
  const bannedMod: Actor = { ...moderator, isBanned: true };

  it("keeps read access", () => {
    assert.equal(can(bannedMod, "content:read"), true);
  });

  it("strips moderation powers from a banned moderator", () => {
    assert.equal(can(bannedMod, "thread:lock"), false);
    assert.equal(can(bannedMod, "post:delete:any"), false);
    assert.equal(can(bannedMod, "post:create"), false);
  });
});

describe("email verification", () => {
  const unverified: Actor = { id: "u9", role: "member", emailVerified: null };

  it("blocks content creation until verified", () => {
    assert.equal(can(unverified, "thread:create"), false);
    assert.equal(can(unverified, "post:create"), false);
    assert.equal(can(unverified, "vote:cast"), false);
  });

  it("still allows reading and reporting abuse", () => {
    assert.equal(can(unverified, "content:read"), true);
    assert.equal(can(unverified, "report:create"), true);
  });
});

describe("locked threads", () => {
  const locked = { threadLocked: true };

  it("blocks replies from members", () => {
    assert.equal(can(member, "post:create", locked), false);
  });

  it("blocks the thread author from editing their own post", () => {
    assert.equal(
      can(member, "post:edit:own", { ...locked, authorId: "u1" }),
      false,
    );
  });

  it("still allows reading and reporting", () => {
    assert.equal(can(member, "content:read", locked), true);
    assert.equal(can(member, "report:create", locked), true);
  });

  it("lets moderators act through the lock", () => {
    assert.equal(can(moderator, "post:delete:any", locked), true);
    assert.equal(can(moderator, "thread:lock", locked), true);
    assert.equal(can(admin, "thread:move", locked), true);
  });

  it("lets a moderator reply to a locked thread, to explain the lock", () => {
    // A lock restricts participants, not the people administering it.
    assert.equal(can(moderator, "post:create", locked), true);
    assert.equal(can(admin, "post:create", locked), true);
    // …but a member still cannot.
    assert.equal(can(member, "post:create", locked), false);
  });
});
