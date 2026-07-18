import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CategoryNav } from "@/components/category-nav";
import { Pagination } from "@/components/pagination";
import { SiteHeader } from "@/components/site-header";
import { ThreadCard } from "@/components/thread-card";
import { getDb } from "@/lib/db";
import {
  THREADS_PER_PAGE,
  getCategoryBySlug,
  getCategoryTree,
  getThreads,
} from "@/lib/queries/forum";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const revalidate = 300;

type Params = {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: Params): Promise<Metadata> {
  const [{ category: slug }, { page: pageParam }] = await Promise.all([
    params,
    searchParams,
  ]);
  const page = Math.max(1, Number(pageParam) || 1);

  const db = await getDb();
  const category = await getCategoryBySlug(db, slug);
  if (!category) return { title: "Category not found", robots: { index: false } };

  const feed = await getThreads(db, {
    categoryIds: [category.id, ...category.childIds],
    page,
  });

  // Page 2+ is self-canonical rather than pointing at page 1: canonicalising
  // paginated pages to the first page hides their threads from the index.
  const canonical = page === 1 ? `/c/${category.slug}` : `/c/${category.slug}?page=${page}`;

  const description =
    page === 1
      ? category.description
      : `${category.description} — page ${page} of ${feed.pageCount}.`;

  return {
    title: page === 1 ? category.name : `${category.name} — page ${page}`,
    description,
    alternates: { canonical },
    openGraph: { type: "website", title: category.name, description, url: canonical },
    other: {
      ...(page > 1 ? { "link:prev": `/c/${category.slug}` } : {}),
    },
  };
}

export default async function CategoryPage({ params, searchParams }: Params) {
  const [{ category: slug }, { page: pageParam }] = await Promise.all([
    params,
    searchParams,
  ]);
  const page = Math.max(1, Number(pageParam) || 1);

  const db = await getDb();
  const category = await getCategoryBySlug(db, slug);
  if (!category) notFound();

  const [categories, feed] = await Promise.all([
    getCategoryTree(db),
    getThreads(db, { categoryIds: [category.id, ...category.childIds], page }),
  ]);

  // A page beyond the last is a 404, not an empty list — otherwise crawlers
  // index unlimited empty pages.
  if (page > 1 && feed.threads.length === 0) notFound();

  const canonicalUrl = `${siteUrl}/c/${category.slug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": canonicalUrl,
    url: canonicalUrl,
    name: category.name,
    description: category.description,
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Meridian", item: siteUrl },
        ...(category.parentSlug
          ? [
              {
                "@type": "ListItem",
                position: 2,
                name: category.parentName,
                item: `${siteUrl}/c/${category.parentSlug}`,
              },
            ]
          : []),
        {
          "@type": "ListItem",
          position: category.parentSlug ? 3 : 2,
          name: category.name,
          item: canonicalUrl,
        },
      ],
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: feed.total,
      itemListElement: feed.threads.map((thread, i) => ({
        "@type": "ListItem",
        position: (page - 1) * THREADS_PER_PAGE + i + 1,
        url: `${siteUrl}/c/${thread.categorySlug}/${thread.slug}-${thread.id}`,
        name: thread.title,
      })),
    },
  };

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />
      <div className="flex flex-col md:flex-row">
        <CategoryNav categories={categories} activeSlug={category.slug} />

        <main className="min-w-0 flex-1 px-4 pb-16 md:px-7">
          <header className="mb-6 max-w-[720px]">
            {category.parentSlug ? (
              <nav aria-label="Breadcrumb" className="text-xs text-text-secondary mb-2">
                <Link href={`/c/${category.parentSlug}`}>{category.parentName}</Link>
                <span aria-hidden> / </span>
                <span>{category.name}</span>
              </nav>
            ) : null}

            <h1 className="text-lg text-text font-bold tracking-[-0.015em]">
              {category.name}
              {page > 1 ? (
                <span className="text-text-secondary font-normal"> — page {page}</span>
              ) : null}
            </h1>

            {/* Hub intro: AI answer engines favour pages that summarise a topic
                before linking out, so this is content, not decoration. */}
            {category.introMarkdown && page === 1 ? (
              <p className="text-base text-comment-text mt-3 leading-relaxed">
                {category.introMarkdown}
              </p>
            ) : null}

            <p className="text-xs text-text-secondary mt-3">
              {feed.total} {feed.total === 1 ? "thread" : "threads"}
            </p>
          </header>

          {feed.threads.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No threads in {category.name} yet.
            </p>
          ) : (
            <div className="flex max-w-[720px] flex-col gap-3.5">
              {feed.threads.map((thread) => (
                <ThreadCard key={thread.id} thread={thread} />
              ))}
            </div>
          )}

          <Pagination
            basePath={`/c/${category.slug}`}
            page={feed.page}
            pageCount={feed.pageCount}
          />
        </main>
      </div>
    </div>
  );
}
