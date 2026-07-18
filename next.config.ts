import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM binary and is dev-only; leave it to Node's resolver
  // instead of bundling it into the server build.
  serverExternalPackages: ["@electric-sql/pglite"],

  // A stray lockfile in the home directory makes Next infer the wrong
  // workspace root; pin it to this project so builds are deterministic.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
