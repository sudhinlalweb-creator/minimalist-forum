import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-12">
      <Link href="/" className="flex items-center gap-2">
        <span className="bg-accent size-5 rounded-md" />
        <span className="text-md text-text font-semibold tracking-[-0.01em]">
          Meridian
        </span>
      </Link>
      {children}
    </div>
  );
}
