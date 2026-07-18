import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { getActor } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { getCategoryTree } from "@/lib/queries/forum";

import { NewThreadForm } from "./form";

export const metadata: Metadata = {
  title: "Start a thread",
  robots: { index: false, follow: false },
};

export default async function NewThreadPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const actor = await getActor();
  if (!actor.id) redirect("/login");

  const { category } = await searchParams;
  const db = await getDb();
  const tree = await getCategoryTree(db);

  // Flattened so sub-categories are selectable, since threads live in leaves
  // as often as in top-level categories.
  const options = tree.flatMap((top) => [
    { id: top.id, label: top.name, slug: top.slug },
    ...top.children.map((c) => ({ id: c.id, label: `${top.name} › ${c.name}`, slug: c.slug })),
  ]);

  const preselected = options.find((o) => o.slug === category)?.id ?? options[0]?.id;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[720px] px-4 pb-16 md:px-7">
        <h1 className="text-lg text-text mb-6 font-bold tracking-[-0.015em]">
          Start a thread
        </h1>
        <NewThreadForm
          categories={options}
          defaultCategoryId={preselected}
          verified={actor.emailVerified !== null}
        />
      </main>
    </>
  );
}
