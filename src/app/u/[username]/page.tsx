import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { SiteHeader } from "@/components/site-header";
import { getDb } from "@/lib/db";
import { serializeJsonLd } from "@/lib/json-ld";
import { activityForReplies } from "@/lib/elevation";
import { getProfileByUsername } from "@/lib/queries/profile";
import { threadPath } from "@/lib/slug";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/** Profiles change as people post; hourly revalidation keeps them fresh. */
export const revalidate = 3600;

type Params = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  const db = await getDb();
  const profile = await getProfileByUsername(db, username);

  if (!profile) return { title: "Profile not found", robots: { index: false } };

  const canonical = `/u/${profile.username}`;
  // Description is built from real activity, not boilerplate — the spec calls
  // for per-page descriptions rather than a template.
  const description =
    profile.bio?.trim() ||
    `${profile.displayName} has started ${profile.threadCount} ${
      profile.threadCount === 1 ? "discussion" : "discussions"
    } and written ${profile.postCount} ${
      profile.postCount === 1 ? "reply" : "replies"
    } on Meridian.`;

  // A profile with no activity is thin content; keep it out of the index but
  // let crawlers follow its links.
  const hasActivity = profile.threadCount + profile.postCount > 0;

  return {
    title: profile.displayName,
    description,
    alternates: { canonical },
    robots: hasActivity ? undefined : { index: false, follow: true },
    openGraph: {
      type: "profile",
      title: `${profile.displayName} · Meridian`,
      description,
      url: canonical,
    },
    twitter: { card: "summary", title: profile.displayName, description },
  };
}

export default async function ProfilePage({ params }: Params) {
  const { username } = await params;
  const db = await getDb();
  const profile = await getProfileByUsername(db, username);

  if (!profile) notFound();

  const canonical = `${siteUrl}/u/${profile.username}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": canonical,
    url: canonical,
    dateCreated: profile.createdAt.toISOString(),
    mainEntity: {
      "@type": "Person",
      "@id": `${canonical}#person`,
      name: profile.displayName,
      alternateName: profile.username,
      url: canonical,
      ...(profile.bio ? { description: profile.bio } : {}),
      ...(profile.image ? { image: profile.image } : {}),
      interactionStatistic: [
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/WriteAction",
          userInteractionCount: profile.threadCount + profile.postCount,
        },
      ],
    },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Meridian", item: siteUrl },
        {
          "@type": "ListItem",
          position: 2,
          name: profile.displayName,
          item: canonical,
        },
      ],
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        // Server-rendered so crawlers see it without executing JS.
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <SiteHeader />

      <main className="mx-auto max-w-[720px] px-7 pb-12">
        <article>
          <header className="mb-8">
            <div className="mb-4 flex items-center gap-3">
              <Avatar name={profile.username} size={48} />
              <div>
                <h1 className="text-lg text-text font-bold tracking-[-0.015em]">
                  {profile.displayName}
                </h1>
                <p className="text-xs text-text-secondary">
                  @{profile.username}
                  {profile.role !== "member" ? ` · ${profile.role}` : ""}
                </p>
              </div>
            </div>

            {profile.bio ? (
              <p className="text-base text-comment-text leading-relaxed">
                {profile.bio}
              </p>
            ) : null}

            <p className="text-xs text-text-secondary mt-4">
              {profile.threadCount} {profile.threadCount === 1 ? "thread" : "threads"}
              {" · "}
              {profile.postCount} {profile.postCount === 1 ? "reply" : "replies"}
              {" · joined "}
              <time dateTime={profile.createdAt.toISOString()}>
                {profile.createdAt.toLocaleDateString("en-GB", {
                  year: "numeric",
                  month: "long",
                })}
              </time>
            </p>
          </header>

          <h2 className="text-xs text-text-secondary mb-4 font-semibold tracking-[0.05em] uppercase">
            Threads
          </h2>

          {profile.recentThreads.length === 0 ? (
            <p className="text-sm text-text-secondary">
              {profile.displayName} hasn&apos;t started any threads yet.
            </p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {profile.recentThreads.map((thread) => (
                <Link
                  key={thread.id}
                  href={threadPath(thread.categorySlug, thread.slug, thread.id)}
                  className={`rounded-xl px-5 py-4 ${activityForReplies(thread.replyCount)}`}
                >
                  <h3 className="text-md text-text font-semibold tracking-[-0.01em]">
                    {thread.title}
                  </h3>
                  <p className="text-xs text-text-secondary mt-2">
                    <time dateTime={thread.createdAt.toISOString()}>
                      {thread.createdAt.toLocaleDateString("en-GB", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                    {" · "}
                    {thread.replyCount}{" "}
                    {thread.replyCount === 1 ? "reply" : "replies"}
                    {" · "}
                    {thread.categoryName}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </article>
      </main>
    </>
  );
}
