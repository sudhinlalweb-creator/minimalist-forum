import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { createDevDb } from "../db/dev";
import { categories, posts, threads, users } from "../db/schema";
import type { AppDb } from "../db/types";
import { getProfileByUsername } from "./profile";

let db: AppDb;
let categoryId: number;

before(async () => {
  db = (await createDevDb()) as unknown as AppDb;
  const [cat] = await db
    .insert(categories)
    .values({ slug: "test-cat", name: "Test", description: "d" })
    .returning({ id: categories.id });
  categoryId = cat.id;
});

describe("getProfileByUsername", () => {
  it("returns null for unknown users", async () => {
    const profile = await getProfileByUsername(db, "doesnotexist");
    assert.equal(profile, null);
  });

  it("returns null for banned users", async () => {
    await db
      .insert(users)
      .values({
        username: "banneduser",
        email: "banned@example.com",
        isBanned: true,
        bannedReason: "Spam",
      });

    const profile = await getProfileByUsername(db, "banneduser");
    assert.equal(profile, null);
  });

  it("returns null for soft-deleted users", async () => {
    await db
      .insert(users)
      .values({
        username: "deleteduser",
        email: "deleted@example.com",
        isDeleted: true,
        deletedAt: new Date(),
      });

    const profile = await getProfileByUsername(db, "deleteduser");
    assert.equal(profile, null);
  });

  it("returns a valid profile with statistics and recent threads", async () => {
    const [user] = await db
      .insert(users)
      .values({
        username: "activeuser",
        email: "active@example.com",
        name: "Active User",
        bio: "Bio here",
        role: "member",
      })
      .returning({ id: users.id });

    // Insert 2 threads (one deleted, one active)
    const [thread1] = await db
      .insert(threads)
      .values({
        categoryId,
        authorId: user.id,
        title: "Active Thread",
        slug: "active-thread",
        body: "Body",
        isDeleted: false,
      })
      .returning({ id: threads.id });

    await db
      .insert(threads)
      .values({
        categoryId,
        authorId: user.id,
        title: "Deleted Thread",
        slug: "deleted-thread",
        body: "Body",
        isDeleted: true,
      });

    // Insert 3 posts (one deleted, two active)
    await db
      .insert(posts)
      .values([
        {
          threadId: thread1.id,
          authorId: user.id,
          body: "Post 1",
          isDeleted: false,
        },
        {
          threadId: thread1.id,
          authorId: user.id,
          body: "Post 2",
          isDeleted: false,
        },
        {
          threadId: thread1.id,
          authorId: user.id,
          body: "Deleted Post",
          isDeleted: true,
        },
      ]);

    const profile = await getProfileByUsername(db, "activeuser");
    assert.ok(profile);
    assert.equal(profile.username, "activeuser");
    assert.equal(profile.displayName, "Active User");
    assert.equal(profile.bio, "Bio here");
    assert.equal(profile.role, "member");
    assert.equal(profile.threadCount, 1); // 1 active, 1 deleted
    assert.equal(profile.postCount, 2); // 2 active, 1 deleted
    assert.equal(profile.recentThreads.length, 1);
    assert.equal(profile.recentThreads[0].title, "Active Thread");
  });

  it("handles case-insensitive username lookups", async () => {
    const [user] = await db
      .insert(users)
      .values({
        username: "CaseSensitive",
        email: "case@example.com",
      })
      .returning({ id: users.id });

    const profileUpper = await getProfileByUsername(db, "CASESENSITIVE");
    const profileLower = await getProfileByUsername(db, "casesensitive");
    
    assert.ok(profileUpper);
    assert.ok(profileLower);
    assert.equal(profileUpper.id, user.id);
    assert.equal(profileLower.id, user.id);
  });

  it("returns recent threads ordered by createdAt descending, limited to 20", async () => {
    const [user] = await db
      .insert(users)
      .values({
        username: "manythreads",
        email: "many@example.com",
      })
      .returning({ id: users.id });

    // Insert 25 threads with sequential timestamps
    const now = new Date();
    const threadInserts = [];
    for (let i = 0; i < 25; i++) {
      threadInserts.push({
        categoryId,
        authorId: user.id,
        title: `Thread ${i}`,
        slug: `thread-${i}`,
        body: `Body ${i}`,
        createdAt: new Date(now.getTime() + i * 1000), // sequential
      });
    }
    await db.insert(threads).values(threadInserts);

    const profile = await getProfileByUsername(db, "manythreads");
    assert.ok(profile);
    assert.equal(profile.recentThreads.length, 20); // capped at 20
    
    // Check that it's descending order of createdAt
    // Thread 24 (newest) should be first, Thread 5 should be last (index 19)
    assert.equal(profile.recentThreads[0].title, "Thread 24");
    assert.equal(profile.recentThreads[19].title, "Thread 5");
  });
});
