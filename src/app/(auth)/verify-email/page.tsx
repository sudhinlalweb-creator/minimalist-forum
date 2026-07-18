import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FormCard, FormNotice } from "@/components/ui/form";
import { verifyEmail } from "@/lib/auth/accounts";
import { getDb } from "@/lib/db";

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
};

/**
 * Verification runs on GET because that is what an emailed link produces.
 * The token is single-use, so a prefetching mail client can burn it — hence the
 * explicit "already confirmed" wording on the failure path.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string }>;
}) {
  const { email, token } = await searchParams;

  if (!email || !token) {
    return (
      <FormCard title="Link not valid" footer={<Link href="/login">Go to sign in</Link>}>
        <FormNotice>This confirmation link is missing information.</FormNotice>
      </FormCard>
    );
  }

  const db = await getDb();
  const result = await verifyEmail(db, email, token);

  if (result.ok) redirect("/login?verified=1");

  return (
    <FormCard
      title={result.reason === "expired_token" ? "Link expired" : "Link not valid"}
      footer={<Link href="/login">Go to sign in</Link>}
    >
      <FormNotice>
        {result.reason === "expired_token"
          ? "Confirmation links last 24 hours. Sign in to request a new one."
          : "This link has already been used, or is not valid. If you have already confirmed your address, just sign in."}
      </FormNotice>
    </FormCard>
  );
}
