import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authenticate, upgradePasswordHash } from "@/lib/auth/accounts";
import type { Role } from "@/lib/auth/permissions";
import { validateSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: Role;
      emailVerified: Date | null;
    } & DefaultSession["user"];
  }
}

/**
 * Auth.js is pinned to the JWT strategy because the Credentials provider
 * requires it (@auth/core refuses credentials sign-in under the database
 * strategy). To keep the instant revocation the brief wanted from database
 * sessions, the `session` callback re-reads the user on every request and runs
 * the token through `validateSession` — so a ban, soft delete, or password
 * change invalidates outstanding tokens immediately rather than at expiry.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const email = typeof raw?.email === "string" ? raw.email : "";
        const password = typeof raw?.password === "string" ? raw.password : "";
        if (!email || !password) return null;

        const db = await getDb();
        const result = await authenticate(db, email, password);
        if (!result.ok) return null;

        // Login is the only point where the plaintext exists, so it is the
        // only chance to migrate a hash to stronger parameters.
        if (result.needsRehash) {
          await upgradePasswordHash(db, result.userId, password);
        }

        // Only the id is carried in the token; everything else is re-read per
        // request, so stale claims cannot outlive a change to the account.
        return { id: result.userId };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },

    async session({ session, token }) {
      if (!token.sub) return session;

      const db = await getDb();
      const [record] = await db
        .select({
          id: users.id,
          username: users.username,
          name: users.name,
          email: users.email,
          image: users.image,
          role: users.role,
          isBanned: users.isBanned,
          isDeleted: users.isDeleted,
          emailVerified: users.emailVerified,
          sessionsValidAfter: users.sessionsValidAfter,
        })
        .from(users)
        .where(eq(users.id, token.sub))
        .limit(1);

      const verdict = validateSession(record ?? null, token.iat ?? null);
      if (!verdict.ok) {
        // Returning a session with no user id makes `auth()` read as signed
        // out, which is what a revoked token should look like.
        return { ...session, user: undefined } as unknown as typeof session;
      }

      session.user = {
        ...session.user,
        id: record.id,
        username: record.username,
        name: record.name,
        email: record.email,
        image: record.image,
        role: record.role,
        emailVerified: record.emailVerified,
      };
      return session;
    },
  },
});
