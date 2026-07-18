import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // OpenNext's Cloudflare bundle. Generated output, already gitignored, but
    // ESLint does not read .gitignore — without this it reports ~17k problems
    // in vendored code and `npm run lint` stops being usable as a signal.
    ".open-next/**",
  ]),
]);

export default eslintConfig;
