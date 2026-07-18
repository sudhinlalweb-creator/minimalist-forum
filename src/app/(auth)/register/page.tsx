import type { Metadata } from "next";
import Link from "next/link";

import { RegisterForm } from "./form";

export const metadata: Metadata = {
  title: "Create an account",
  // Auth pages carry no content worth indexing and would dilute the crawl budget.
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return <RegisterForm footer={<>Already have an account? <Link href="/login">Sign in</Link>.</>} />;
}
