import type { Metadata } from "next";

import { CategoryNav } from "@/components/category-nav";
import { Pagination } from "@/components/pagination";
import { SiteHeader } from "@/components/site-header";
import { ThreadCard } from "@/components/thread-card";
import { getDb } from "@/lib/db";
import { getCategoryTree, getThreads } from "@/lib/queries/forum";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Meridian — product, design and engineering discussion",
  description:
    "A minimalist forum for people who build software. Threads on product decisions, interface craft, and engineering trade-offs.",
  alternates: { canonical: "/" },
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const db = await getDb();
  const [categories, feed] = await Promise.all([
    getCategoryTree(db),
    getThreads(db, { page }),
  ]);

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="flex flex-col md:flex-row">
        <CategoryNav categories={categories} />

        <main className="min-w-0 flex-1 px-4 pb-16 md:px-7">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <h1 className="text-md text-text font-semibold tracking-[-0.01em]">
              All Spaces
            </h1>
            <p className="text-xs text-text-secondary">
              {feed.total} {feed.total === 1 ? "thread" : "threads"}
            </p>
          </div>

          {feed.threads.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No threads yet. Be the first to start one.
            </p>
          ) : (
            <div className="flex max-w-[720px] flex-col gap-3.5">
              {feed.threads.map((thread) => (
                <ThreadCard key={thread.id} thread={thread} />
              ))}
            </div>
          )}

          <Pagination basePath="/" page={feed.page} pageCount={feed.pageCount} />
        </main>
      </div>
    </div>
  );
}
