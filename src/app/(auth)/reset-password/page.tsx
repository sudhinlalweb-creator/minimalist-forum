import type { Metadata } from "next";
import Link from "next/link";

import { FormCard } from "@/components/ui/form";
import { ResetPasswordForm } from "./form";

export const metadata: Metadata = {
  title: "Set a new password",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string }>;
}) {
  const { email, token } = await searchParams;

  if (!email || !token) {
    return (
      <FormCard
        title="Link not valid"
        description="This reset link is missing information. Request a new one."
        footer={<Link href="/forgot-password">Request a new link</Link>}
      >
        <></>
      </FormCard>
    );
  }

  return (
    <ResetPasswordForm
      email={email}
      token={token}
      footer={<Link href="/login">Back to sign in</Link>}
    />
  );
}
