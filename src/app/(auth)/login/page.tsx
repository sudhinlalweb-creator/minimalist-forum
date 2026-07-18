import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "./form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; verified?: string }>;
}) {
  const params = await searchParams;
  const notice = params.reset
    ? "Your password has been changed. Please sign in."
    : params.verified
      ? "Your email is confirmed. Please sign in."
      : undefined;

  return (
    <LoginForm
      initialNotice={notice}
      footer={
        <>
          <Link href="/forgot-password">Forgot your password?</Link>
          <br />
          No account? <Link href="/register">Create one</Link>.
        </>
      }
    />
  );
}
