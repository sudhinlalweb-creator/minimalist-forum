import { cache } from "react";

import { auth } from "@/auth";

import { type Actor, GUEST_ACTOR } from "./permissions";

/**
 * The signed-in user as an `Actor`, or the guest actor when signed out.
 *
 * Wrapped in React's `cache` so several server components on one page share a
 * single session resolution — otherwise every `can()` check would re-read the
 * user from the database, which the JWT strategy already costs us once.
 */
export const getActor = cache(async (): Promise<Actor> => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return GUEST_ACTOR;

  return {
    id: user.id,
    role: user.role,
    emailVerified: user.emailVerified,
    isBanned: false, // a banned user never resolves to a session at all
  };
});

/** Full session user for rendering (name, avatar, username). Null if signed out. */
export const getSessionUser = cache(async () => {
  const session = await auth();
  return session?.user?.id ? session.user : null;
});
