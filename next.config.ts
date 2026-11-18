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

// shortcut: the one known domain of the public Vercel project; if it gets a custom domain, Vercel reports that one, so update this.
const PUBLIC_SITE = "pupo-portfolio.vercel.app";

// The admin lives in *.dev.tsx / *.dev.ts files. The dev server and the ADMIN=1 build (the admin project on Vercel)
// treat those as routes; the public production build ignores them and exports a static site (route handlers that
// read the request can't be exported, so `output: "export"` must stay off in both of the others).
export default function config(phase: string): NextConfig {
  const admin = process.env.ADMIN === "1";
  if (admin && process.env.VERCEL_PROJECT_PRODUCTION_URL === PUBLIC_SITE) {
    throw new Error(`ADMIN=1 is set on the public project (${PUBLIC_SITE}). Remove it there: the admin belongs on the admin project only.`);
  }
  if (admin || phase === PHASE_DEVELOPMENT_SERVER) {
    return { ...nextConfig, pageExtensions: ["tsx", "ts", "jsx", "js", "dev.tsx", "dev.ts"] };
  }
  return { ...nextConfig, output: "export" };
}
