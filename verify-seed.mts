import { PGlite } from "@electric-sql/pglite";

const db = new PGlite(".pglite");
await db.waitReady;

const q = async (label: string, sql: string) => {
  const r = await db.query(sql);
  console.log(`\n▸ ${label}`);
  console.table(r.rows);
};

await q(
  "category hierarchy (top-level + child count)",
  `SELECT p.slug, p.name, count(c.id) AS subs
   FROM categories p LEFT JOIN categories c ON c.parent_id = p.id
   WHERE p.parent_id IS NULL GROUP BY p.slug, p.name ORDER BY p.slug`,
);

await q(
  "threads: counters vs actual rows",
  `SELECT t.slug, c.slug AS category, u.username AS author,
          t.reply_count,
          (SELECT count(*) FROM posts p WHERE p.thread_id = t.id) AS actual_posts,
          t.vote_score,
          (SELECT count(*) FROM votes v WHERE v.target_id = t.id AND v.target_type = 'thread') AS actual_votes
   FROM threads t
   JOIN categories c ON c.id = t.category_id
   JOIN users u ON u.id = t.author_id
   ORDER BY t.id`,
);

await q("roles", `SELECT role, count(*) FROM users GROUP BY role ORDER BY role`);

await q(
  "tag counts vs join table",
  `SELECT tg.slug, tg.thread_count,
          (SELECT count(*) FROM thread_tags tt WHERE tt.tag_id = tg.id) AS actual
   FROM tags tg ORDER BY tg.slug LIMIT 5`,
);

await q(
  "full-text search: 'virtualization performance'",
  `SELECT title FROM threads
   WHERE search_vector @@ websearch_to_tsquery('english', 'virtualization performance')`,
);
