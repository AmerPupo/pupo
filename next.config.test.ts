import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import config from "./next.config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config", () => {
  it("exports a static site, with no admin pages, for the public build", () => {
    vi.stubEnv("ADMIN", undefined);
    const result = config(PHASE_PRODUCTION_BUILD);

    expect(result.output).toBe("export");
    expect(result.pageExtensions).toBeUndefined();
  });

  it("adds the admin pages in the dev server, and does not export", () => {
    vi.stubEnv("ADMIN", undefined);
    const result = config(PHASE_DEVELOPMENT_SERVER);

    expect(result.output).toBeUndefined();
    expect(result.pageExtensions).toEqual(expect.arrayContaining(["dev.tsx", "dev.ts"]));
  });

  it("adds the admin pages and drops the static export when ADMIN=1", () => {
    vi.stubEnv("ADMIN", "1");
    const result = config(PHASE_PRODUCTION_BUILD);

    expect(result.output).toBeUndefined();
    expect(result.pageExtensions).toEqual(["tsx", "ts", "jsx", "js", "dev.tsx", "dev.ts"]);
  });

  it.each(["0", "true", "yes", ""])("treats ADMIN=%j as off", (value) => {
    vi.stubEnv("ADMIN", value);
    const result = config(PHASE_PRODUCTION_BUILD);

    expect(result.output).toBe("export");
    expect(result.pageExtensions).toBeUndefined();
  });

  it("builds the admin on another Vercel project", () => {
    vi.stubEnv("ADMIN", "1");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pupo-admin.vercel.app");

    expect(config(PHASE_PRODUCTION_BUILD).output).toBeUndefined();
  });

  it("refuses ADMIN=1 on the public project, and names why", () => {
    vi.stubEnv("ADMIN", "1");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pupo-portfolio.vercel.app");

    expect(() => config(PHASE_PRODUCTION_BUILD)).toThrow(/ADMIN=1.*pupo-portfolio\.vercel\.app/);
  });

  it("still builds the public project without ADMIN", () => {
    vi.stubEnv("ADMIN", undefined);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pupo-portfolio.vercel.app");

    expect(config(PHASE_PRODUCTION_BUILD).output).toBe("export");
  });
});
