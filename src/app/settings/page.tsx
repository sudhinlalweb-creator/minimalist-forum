import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { getSessionUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

import { SettingsForms } from "./forms";

export const metadata: Metadata = {
  title: "Account settings",
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const db = await getDb();
  const [record] = await db
    .select({ name: users.name, bio: users.bio, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[560px] px-7 pb-16">
        <h1 className="text-lg text-text mb-8 font-bold tracking-[-0.015em]">
          Account settings
        </h1>
        <SettingsForms
          displayName={record?.name ?? user.username}
          bio={record?.bio ?? ""}
          email={record?.email ?? ""}
          emailVerified={user.emailVerified !== null}
        />
      </main>
    </>
  );
}
