import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig: NextConfig = {
  /* config options here */
  agentRules: false, // otherwise `next dev` re-creates AGENTS.md; declined at scaffold time
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// The admin lives in *.dev.tsx / *.dev.ts files. Only the dev server treats those as routes;
// the production build ignores them and exports a static site (route handlers that read
// the request can't be exported, so `output: "export"` must stay off in dev).
export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return { ...nextConfig, pageExtensions: ["tsx", "ts", "jsx", "js", "dev.tsx", "dev.ts"] };
  }
  return { ...nextConfig, output: "export" };
}
