import { renderToStaticMarkup } from "react-dom/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApp } from "@/components/admin/AdminApp";
import { listRepos } from "@/lib/admin/github";
import { GitHubError, listRepos as listRemoteRepos, readProjectsFile } from "@/lib/admin/remote";
import { SESSION_COOKIE, sealSession } from "@/lib/admin/session";
import { readProjects, type Project } from "@/lib/projects";
import AdminPage from "./page.dev";

// The page lists every repo, private names included, so a request under a foreign Host must get a 404 before gh is even asked.
// The real notFound() throws a special error that Next turns into the 404 page, so the mock throws too.
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/admin/github", () => ({ listRepos: vi.fn(), OWNER: "AmerPupo" }));
vi.mock("@/lib/admin/remote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/remote")>()),
  listRepos: vi.fn(),
  readProjectsFile: vi.fn(),
}));
vi.mock("@/lib/projects", () => ({ readProjects: vi.fn() }));
vi.mock("@/components/admin/AdminApp", () => ({ AdminApp: vi.fn(() => null) }));

const asRequest = (host: string | null, cookie?: string) => {
  const map: Record<string, string> = {};
  if (host !== null) map.host = host;
  if (cookie !== undefined) map.cookie = cookie;
  vi.mocked(headers).mockResolvedValue(new Headers(map) as unknown as Awaited<ReturnType<typeof headers>>);
};
const asHost = (host: string | null) => asRequest(host);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN", undefined);
  vi.mocked(listRepos).mockResolvedValue([]);
  vi.mocked(readProjects).mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the admin page", () => {
  it.each(["localhost:3000", "127.0.0.1:3217"])("renders for the local host %s", async (host) => {
    asHost(host);
    expect(await AdminPage()).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
    expect(listRepos).toHaveBeenCalledTimes(1);
  });

  // The page answers 404 and loads nothing: no gh call, no read of projects.json.
  it.each<[string, string | null]>([
    ["a foreign host", "evil.example:3217"],
    ["a look-alike host", "localhost.evil.com:3217"],
    ["a look-alike with a local name inside", "127.0.0.1.evil.com:3217"],
    ["no port", "localhost"],
    ["no Host header", null],
  ])("answers 404 for %s, before it asks gh for anything", async (_, host) => {
    asHost(host);
    await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(listRepos).not.toHaveBeenCalled();
    expect(readProjects).not.toHaveBeenCalled();
  });

  it("gives the app no sha, so it saves the plain array as before", async () => {
    asHost("localhost:3000");
    renderToStaticMarkup(await AdminPage());

    expect(vi.mocked(AdminApp).mock.calls[0][0]).toEqual({ repos: [], projects: [] });
  });

  it("says it is dev only, and has no sign-in or sign-out", async () => {
    asHost("localhost:3000");
    const markup = renderToStaticMarkup(await AdminPage());

    expect(markup).toContain("Admin (dev only)");
    expect(markup).not.toContain("Sign in with GitHub");
    expect(markup).not.toContain("Sign out");
  });
});

describe("the admin page on the admin project (ADMIN=1)", () => {
  const TOKEN = "test-oauth-token-value";
  const HOST = "pupo-admin.vercel.app";
  const SIGN_IN = 'href="/api/admin/auth/login"';
  const repos = [
    { name: "demo-app", visibility: "PUBLIC" as const, primaryLanguage: null, updatedAt: "2026-11-10T14:00:25Z", isFork: false, isArchived: false, url: "https://github.com/AmerPupo/demo-app", homepageUrl: "" },
  ];
  const projects: Project[] = [
    { slug: "demo-app", name: "Demo App", tagline: "t", description: "d", tech: ["x"], repoUrl: "https://github.com/AmerPupo/demo-app", published: true },
  ];

  const signedIn = (overrides: { exp?: number } = {}) => {
    vi.stubEnv("SESSION_SECRET", Buffer.alloc(32, 7).toString("base64"));
    return `a=1; ${SESSION_COOKIE}=${sealSession({ login: "AmerPupo", token: TOKEN, exp: overrides.exp ?? Date.now() + 60_000 })}`;
  };
  const render = async () => renderToStaticMarkup(await AdminPage());

  beforeEach(() => {
    vi.stubEnv("ADMIN", "1");
    vi.mocked(listRemoteRepos).mockResolvedValue(repos);
    vi.mocked(readProjectsFile).mockResolvedValue({ projects, sha: "abc123" });
  });

  describe("signed out", () => {
    it.each<[string, () => string | undefined]>([
      ["no cookie", () => undefined],
      ["an unrelated cookie", () => "a=1"],
      ["a garbage session cookie", () => `${SESSION_COOKIE}=garbage`],
      ["an expired session", () => signedIn({ exp: Date.now() - 1 })],
    ])("shows only the sign-in link for %s, and asks GitHub for nothing", async (_, makeCookie) => {
      vi.stubEnv("SESSION_SECRET", Buffer.alloc(32, 7).toString("base64"));
      asRequest(HOST, makeCookie());
      const markup = await render();

      expect(markup).toContain(SIGN_IN);
      expect(markup).toContain("Sign in with GitHub");
      expect(markup).not.toContain("Sign out");
      expect(AdminApp).not.toHaveBeenCalled();
      expect(listRemoteRepos).not.toHaveBeenCalled();
      expect(readProjectsFile).not.toHaveBeenCalled();
      expect(listRepos).not.toHaveBeenCalled();
      expect(readProjects).not.toHaveBeenCalled();
    });

    it("shows the sign-in link when SESSION_SECRET is missing, even with a session cookie", async () => {
      const cookie = signedIn();
      vi.stubEnv("SESSION_SECRET", undefined);
      asRequest(HOST, cookie);

      expect(await render()).toContain(SIGN_IN);
      expect(listRemoteRepos).not.toHaveBeenCalled();
    });
  });

  describe("signed in", () => {
    it("lists from GitHub with the user's token, and shows the admin with a sign-out button", async () => {
      asRequest(HOST, signedIn());
      const markup = await render();

      expect(listRemoteRepos).toHaveBeenCalledWith(TOKEN);
      expect(readProjectsFile).toHaveBeenCalledWith(TOKEN);
      // The sha is what the next save has to send back, or GitHub refuses it.
      expect(vi.mocked(AdminApp).mock.calls[0][0]).toEqual({ repos, projects, sha: "abc123" });
      expect(markup).toMatch(/<h1[^>]*>Admin<\/h1>/);
      expect(markup).not.toContain("dev only");
      expect(markup).not.toContain("Sign in with GitHub");
      // A plain form POST, so signing out needs no script, and the browser sends the Origin header the route checks.
      expect(markup).toMatch(/<form[^>]*method="post"[^>]*action="\/api\/admin\/auth\/logout"|<form[^>]*action="\/api\/admin\/auth\/logout"[^>]*method="post"/);
      expect(markup).toContain("Sign out");
    });

    it("never reads gh or the local projects.json, and never answers 404 for the host", async () => {
      asRequest(HOST, signedIn());
      await render();

      expect(listRepos).not.toHaveBeenCalled();
      expect(readProjects).not.toHaveBeenCalled();
      expect(notFound).not.toHaveBeenCalled();
    });

    it("does not check the Host (Vercel's host is not a local one)", async () => {
      asRequest("some-preview-123.vercel.app", signedIn());

      expect(await render()).toMatch(/<h1[^>]*>Admin<\/h1>/);
      expect(notFound).not.toHaveBeenCalled();
    });

    it("puts the token nowhere in the page", async () => {
      asRequest(HOST, signedIn());

      expect(await render()).not.toContain(TOKEN);
    });
  });

  describe("when GitHub refuses", () => {
    it("shows the error and a sign-in link for a revoked token (401)", async () => {
      asRequest(HOST, signedIn());
      vi.mocked(listRemoteRepos).mockRejectedValue(new GitHubError(401, '{"message":"Bad credentials"}'));
      const markup = await render();

      expect(markup).toContain('role="alert"');
      expect(markup).toContain("Bad credentials");
      expect(markup).toContain(SIGN_IN);
      expect(AdminApp).not.toHaveBeenCalled();
      expect(markup).not.toContain(TOKEN);
    });

    it("also treats a 401 from the projects file as a revoked token", async () => {
      asRequest(HOST, signedIn());
      vi.mocked(readProjectsFile).mockRejectedValue(new GitHubError(401, "Bad credentials"));

      expect(await render()).toContain(SIGN_IN);
    });

    it.each<[string, Error]>([
      ["a GitHub 500", new GitHubError(500, "boom")],
      ["a GitHub 403 (rate limit)", new GitHubError(403, "rate limit")],
      ["a projects.json that fails parseProjects", new Error('projects.json entry 1 "demo-app": tagline is 101 characters')],
      ["a network failure", new Error("fetch failed")],
    ])("shows the error, with no sign-in link, for %s", async (_, error) => {
      asRequest(HOST, signedIn());
      vi.mocked(readProjectsFile).mockRejectedValue(error);
      const markup = await render();

      expect(markup).toContain('role="alert"');
      expect(markup).toContain(error.message.slice(0, 20).replace(/"/g, "&quot;"));
      expect(markup).not.toContain(SIGN_IN);
      expect(AdminApp).not.toHaveBeenCalled();
    });

    it("keeps the Sign out button on an error page, so a stuck session can be dropped", async () => {
      asRequest(HOST, signedIn());
      vi.mocked(listRemoteRepos).mockRejectedValue(new GitHubError(500, "boom"));

      expect(await render()).toContain("Sign out");
    });
  });
});
