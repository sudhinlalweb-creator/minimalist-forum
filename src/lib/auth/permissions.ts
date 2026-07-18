/**
 * Authorization matrix.
 *
 * Deliberately dependency-free: no database, no session, no Auth.js import.
 * Everything here is a pure function of (actor, permission, resource owner),
 * so it can be unit-checked before any auth wiring exists and reused
 * unchanged on the server, in route handlers, and in server actions.
 *
 * Roles inherit upward: guest ⊂ member ⊂ moderator ⊂ admin.
 */

/** The DB enum is member|moderator|admin; "guest" means no session. */
export type Role = "guest" | "member" | "moderator" | "admin";

export type Permission =
  // Reading is public — the entire SEO/GEO premise depends on it.
  | "content:read"
  // Participation
  | "thread:create"
  | "post:create"
  | "vote:cast"
  | "report:create"
  // Own content
  | "thread:edit:own"
  | "thread:delete:own"
  | "post:edit:own"
  | "post:delete:own"
  // Moderation
  | "thread:edit:any"
  | "thread:delete:any"
  | "thread:lock"
  | "thread:pin"
  | "thread:move"
  | "post:edit:any"
  | "post:delete:any"
  | "report:review"
  | "user:ban"
  // Administration
  | "user:manage"
  | "role:assign"
  | "category:manage"
  | "settings:manage";

const GUEST = ["content:read"] as const satisfies readonly Permission[];

const MEMBER = [
  ...GUEST,
  "thread:create",
  "post:create",
  "vote:cast",
  "report:create",
  "thread:edit:own",
  "thread:delete:own",
  "post:edit:own",
  "post:delete:own",
] as const satisfies readonly Permission[];

const MODERATOR = [
  ...MEMBER,
  "thread:edit:any",
  "thread:delete:any",
  "thread:lock",
  "thread:pin",
  "thread:move",
  "post:edit:any",
  "post:delete:any",
  "report:review",
  "user:ban",
] as const satisfies readonly Permission[];

const ADMIN = [
  ...MODERATOR,
  "user:manage",
  "role:assign",
  "category:manage",
  "settings:manage",
] as const satisfies readonly Permission[];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  guest: GUEST,
  member: MEMBER,
  moderator: MODERATOR,
  admin: ADMIN,
};

/** The subset of a user record authorization actually depends on. */
export interface Actor {
  id: string;
  role: Role;
  isBanned?: boolean;
  /** Unverified users may read but not post — blocks drive-by spam signups. */
  emailVerified?: Date | null;
}

/** Anonymous visitor. */
export const GUEST_ACTOR: Actor = { id: "", role: "guest" };

export interface ResourceContext {
  /** Author of the thread/post being acted on, for `:own` permissions. */
  authorId?: string;
  /** Locked threads reject new posts and edits from non-moderators. */
  threadLocked?: boolean;
}

/**
 * Permissions that require a verified email address. Reading and reporting
 * stay open so unverified accounts can still browse and flag abuse.
 */
const REQUIRES_VERIFIED_EMAIL = new Set<Permission>([
  "thread:create",
  "post:create",
  "vote:cast",
]);

/**
 * Holding this permission means locks do not apply to you. A lock restricts
 * participants, not the people administering the thread — a moderator must
 * still be able to reply to a locked thread to explain why it was locked.
 */
const LOCK_BYPASS_PERMISSION: Permission = "thread:lock";

export function hasRolePermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * The single authorization entry point. Everything that mutates content should
 * route through this rather than checking `role === "admin"` inline.
 */
export function can(
  actor: Actor,
  permission: Permission,
  resource: ResourceContext = {},
): boolean {
  // Banned users retain read access only. Checked before role lookup so a
  // banned moderator cannot moderate.
  if (actor.isBanned && permission !== "content:read") return false;

  if (!hasRolePermission(actor.role, permission)) return false;

  if (REQUIRES_VERIFIED_EMAIL.has(permission) && !actor.emailVerified) {
    return false;
  }

  // `:own` permissions additionally require ownership.
  if (permission.endsWith(":own")) {
    if (!actor.id || !resource.authorId) return false;
    if (actor.id !== resource.authorId) return false;
  }

  // A locked thread is closed to every participant — including its own author —
  // but not to moderators, who need to act on and explain the lock.
  if (
    resource.threadLocked &&
    !hasRolePermission(actor.role, LOCK_BYPASS_PERMISSION)
  ) {
    const isMutation =
      permission !== "content:read" && permission !== "report:create";
    if (isMutation) return false;
  }

  return true;
}

/** Throwing variant for server actions and route handlers. */
export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Forbidden: missing permission "${permission}"`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(
  actor: Actor,
  permission: Permission,
  resource: ResourceContext = {},
): void {
  if (!can(actor, permission, resource)) throw new ForbiddenError(permission);
}

/** Every permission a role holds — used to render the matrix for review. */
export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export const ALL_ROLES: readonly Role[] = ["guest", "member", "moderator", "admin"];
export const ALL_PERMISSIONS: readonly Permission[] = ADMIN;
