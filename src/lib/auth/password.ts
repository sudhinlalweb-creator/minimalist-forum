import {
  type ScryptOptions,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

/**
 * `promisify` collapses scrypt's overloads onto the 3-argument form, dropping
 * the options parameter we rely on to set N/r/p. Restore the real signature.
 */
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing via scrypt from node:crypto.
 *
 * No dependency, no native binary to build on Vercel, and none of bcrypt's
 * silent truncation at 72 bytes. Parameters are stored inside the hash string
 * so they can be raised later without invalidating existing passwords —
 * `needsRehash` reports when a stored hash predates the current cost.
 *
 * Format: scrypt$N$r$p$<salt-b64>$<key-b64>
 */

const PARAMS = { N: 32768, r: 8, p: 1 } as const;
const KEY_LEN = 64;
const SALT_LEN = 16;
// 128 * N * r = 32 MiB at N=32768, r=8. Node's default maxmem is 32 MiB, which
// this would sit exactly on, so raise the ceiling explicitly.
const MAX_MEM = 96 * 1024 * 1024;

/**
 * Guard against DoS via multi-megabyte passwords: scrypt cost is independent of
 * input length, but hashing a huge string still wastes memory and bandwidth.
 */
export const MAX_PASSWORD_BYTES = 1024;

export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  assertHashable(password);

  const salt = randomBytes(SALT_LEN);
  const key = (await scrypt(password.normalize("NFKC"), salt, KEY_LEN, {
    ...PARAMS,
    maxmem: MAX_MEM,
  })) as Buffer;

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Always returns a boolean — a malformed stored hash is a failed login, not an
 * exception that could leak which accounts have broken records.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;

  const parsed = parseHash(stored);
  if (!parsed) return false;

  let candidate: Buffer;
  try {
    assertHashable(password);
    candidate = (await scrypt(
      password.normalize("NFKC"),
      parsed.salt,
      parsed.key.length,
      { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: MAX_MEM },
    )) as Buffer;
  } catch {
    return false;
  }

  return timingSafeEqual(candidate, parsed.key);
}

/** True when a valid hash was produced with weaker parameters than current. */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return parsed.N < PARAMS.N || parsed.r < PARAMS.r || parsed.p < PARAMS.p;
}

function assertHashable(password: string): void {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new Error(`Password exceeds ${MAX_PASSWORD_BYTES} bytes`);
  }
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;

  const [, nRaw, rRaw, pRaw, saltB64, keyB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);

  if (![N, r, p].every((v) => Number.isSafeInteger(v) && v > 0)) return null;
  // Reject absurd stored parameters rather than letting them allocate.
  if (N > 1 << 20 || r > 32 || p > 16) return null;

  try {
    const salt = Buffer.from(saltB64, "base64");
    const key = Buffer.from(keyB64, "base64");
    if (salt.length === 0 || key.length === 0) return null;
    return { N, r, p, salt, key };
  } catch {
    return null;
  }
}
