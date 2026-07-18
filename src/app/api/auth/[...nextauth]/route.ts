import { handlers } from "@/auth";

export const { GET, POST } = handlers;

// PGlite (dev fallback) and scrypt both need Node APIs, not the edge runtime.
export const runtime = "nodejs";
