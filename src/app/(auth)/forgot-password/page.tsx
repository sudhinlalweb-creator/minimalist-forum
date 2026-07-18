import type { Metadata } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "./form";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm footer={<Link href="/login">Back to sign in</Link>} />;
}
