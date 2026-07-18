import Link from "next/link";

import { signOut } from "@/auth";
import { getSessionUser } from "@/lib/auth/current-user";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

/**
 * Server component: the signed-in state is rendered on the server, so the
 * header never flashes a signed-out state on first paint and costs no client
 * JavaScript beyond the sign-out form's submit.
 */
export async function SiteHeader() {
  const user = await getSessionUser();

  return (
    <header className="flex items-center justify-between gap-4 px-7 py-4">
      <Link href="/" className="flex items-center gap-2">
        <span className="bg-accent size-5 rounded-md" />
        <span className="text-md text-text font-semibold tracking-[-0.01em]">
          Meridian
        </span>
      </Link>

      <nav className="flex items-center gap-4">
        {user ? (
          <>
            <Link
              href="/new"
              className="bg-accent text-on-accent rounded-md px-3 py-1.5 text-sm font-semibold"
            >
              New thread
            </Link>
            <Link
              href={`/u/${user.username}`}
              className="text-sm text-text-secondary hover:text-text"
            >
              {user.username}
            </Link>
            <Link
              href="/settings"
              className="text-sm text-text-secondary hover:text-text"
            >
              Settings
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-sm text-text-secondary hover:text-text cursor-pointer"
              >
                Sign out
              </button>
            </form>
          </>
        ) : (
          <>
            <Link href="/login" className="text-sm text-text-secondary hover:text-text">
              Sign in
            </Link>
            <Link
              href="/register"
              className="bg-accent text-on-accent rounded-md px-3 py-1.5 text-sm font-semibold"
            >
              Join
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
