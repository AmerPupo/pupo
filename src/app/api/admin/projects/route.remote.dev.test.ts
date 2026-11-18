import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listRepos as listLocalRepos, type Repo } from "@/lib/admin/github";
import { commitProjects, ConflictError, GitHubError, listRepos } from "@/lib/admin/remote";
import { SESSION_COOKIE, sealSession } from "@/lib/admin/session";
import { writeProjects } from "@/lib/admin/writeProjects";
import type { Project } from "@/lib/projects";
import { PUT } from "./route.dev";

// The admin project (ADMIN=1): a save is a commit on main made with the signed-in user's token. The session is real (sealed with a test key),
// and GitHub is mocked, so no test commits anything. The local-mode cases are in route.dev.test.ts and don't change.
vi.mock("@/lib/admin/github", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/github")>()),
  listRepos: vi.fn(),
}));
vi.mock("@/lib/admin/remote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/remote")>()),
  listRepos: vi.fn(),
  commitProjects: vi.fn(),
}));
vi.mock("@/lib/admin/writeProjects", () => ({ writeProjects: vi.fn() }));

const TOKEN = "test-oauth-token-value";
const HOST = "pupo-admin.example";
const ORIGIN = `https://${HOST}`;
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const NEW_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f001122334";

const repo = (name: string, visibility: Repo["visibility"] = "PUBLIC"): Repo => ({
  name,
  visibility,
  primaryLanguage: null,
  updatedAt: "2026-11-10T14:00:25Z",
  isFork: false,
  isArchived: false,
  url: `https://github.com/AmerPupo/${name}`,
  homepageUrl: "",
});

const project = (slug: string, published: boolean): Project => ({
  slug,
  name: slug,
  tagline: "A tagline.",
  description: "A description.",
  tech: ["TypeScript"],
  repoUrl: `https://github.com/AmerPupo/${slug}`,
  published,
});

const session = () => `${SESSION_COOKIE}=${sealSession({ login: "AmerPupo", token: TOKEN, exp: Date.now() + 60_000 })}`;

type Options = { cookie?: string | null; origin?: string | null; host?: string | null };

// `null` sends no such header at all. A string body is sent as it is, so malformed JSON can be tested.
function put(body: unknown, { cookie = session(), origin = ORIGIN, host = HOST }: Options = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie !== null) headers.cookie = cookie;
  if (origin !== null) headers.origin = origin;
  if (host !== null) headers.host = host;
  return PUT(
    new Request(`${ORIGIN}/api/admin/projects`, {
      method: "PUT",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const save = (projects: Project[], sha: unknown = SHA) => ({ projects, sha });

const nothingRan = () => {
  expect(listRepos).not.toHaveBeenCalled();
  expect(commitProjects).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ADMIN", "1");
  vi.stubEnv("SESSION_SECRET", Buffer.alloc(32, 7).toString("base64"));
  vi.mocked(listRepos).mockResolvedValue([repo("demo-app"), repo("tools"), repo("notes", "PRIVATE"), repo("team-wiki", "INTERNAL")]);
  vi.mocked(commitProjects).mockResolvedValue(NEW_SHA);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PUT /api/admin/projects on the admin project", () => {
  // The gate runs first: a body that is malformed on purpose proves nothing was read or asked for before it answered.
  describe("the gate", () => {
    it.each<[string, string | null]>([
      ["no Origin", null],
      ["a foreign site", "https://example.com"],
      ["a look-alike host", `https://${HOST}.evil.com`],
      ["plain http", `http://${HOST}`],
      ["a local origin (this is not the local admin)", "http://127.0.0.1:3000"],
    ])("answers 403 for %s, and nothing is listed or committed", async (_, origin) => {
      const response = await put("{not json", { origin });
      expect(response.status).toBe(403);
      nothingRan();
    });

    it("answers 403 for a foreign Origin even when there is no session", async () => {
      expect((await put("{not json", { origin: "https://example.com", cookie: null })).status).toBe(403);
      nothingRan();
    });

    // A function, so the session is sealed after beforeEach has set the key.
    it.each<[string, () => string | null]>([
      ["no cookie", () => null],
      ["an unrelated cookie", () => "a=1"],
      ["a garbage session", () => `${SESSION_COOKIE}=garbage`],
      ["an expired session", () => `${SESSION_COOKIE}=${sealSession({ login: "AmerPupo", token: TOKEN, exp: Date.now() - 1 })}`],
    ])("answers 401 for %s, and nothing is listed or committed", async (_, cookie) => {
      const response = await put("{not json", { cookie: cookie() });
      expect(response.status).toBe(401);
      nothingRan();
    });

    it("does not touch gh or the disk, which belong to the local admin", async () => {
      await put(save([project("demo-app", true)]));
      expect(listLocalRepos).not.toHaveBeenCalled();
      expect(writeProjects).not.toHaveBeenCalled();
    });
  });

  describe("the body", () => {
    it.each<[string, unknown, RegExp]>([
      ["malformed JSON", "{not json", /JSON/],
      ["the local body, a plain array", [project("demo-app", true)], /\{ projects, sha \}/],
      ["no sha", { projects: [project("demo-app", true)] }, /sha/],
      ["an empty sha", save([project("demo-app", true)], ""), /sha/],
      ["a numeric sha", save([project("demo-app", true)], 5), /sha/],
      ["a null body", null, /\{ projects, sha \}/],
      ["projects that aren't an array", save({ slug: "demo-app" } as unknown as Project[]), /must be an array/],
      ["a missing name", save([{ ...project("demo-app", true), name: undefined } as unknown as Project]), /entry 1 "demo-app": name/],
      ["a duplicate slug", save([project("demo-app", true), project("demo-app", false)]), /duplicate slug/],
      ["a javascript: demo URL", save([{ ...project("demo-app", true), demoUrl: "javascript:alert(1)" }]), /demoUrl/],
    ])("answers 400 for %s, and nothing is listed or committed", async (_, body, message) => {
      const response = await put(body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(message);
      nothingRan();
    });
  });

  describe("the publish guard", () => {
    it.each<[string, string]>([
      ["a private repo", "notes"],
      ["an INTERNAL repo", "team-wiki"],
      ["a repo that is not listed (renamed or deleted)", "renamed-away"],
    ])("answers 400 for a published entry whose repo is %s, and commits nothing", async (_, slug) => {
      const response = await put(save([project("demo-app", true), project(slug, true)]));

      expect(response.status).toBe(400);
      const { error } = await response.json();
      expect(error).toMatch(/Not saved/);
      expect(error).toContain(slug);
      expect(error).not.toContain("demo-app");
      expect(listRepos).toHaveBeenCalledWith(TOKEN);
      expect(commitProjects).not.toHaveBeenCalled();
    });

    it("names every offender, and commits nothing when only one of two is bad", async () => {
      const response = await put(save([project("notes", true), project("demo-app", true), project("team-wiki", true)]));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/notes, team-wiki/);
      expect(commitProjects).not.toHaveBeenCalled();
    });

    // That is how an entry of a deleted or private repo can still be taken down.
    it.each(["notes", "team-wiki", "renamed-away"])("accepts an unpublished entry whose repo is %s", async (slug) => {
      const projects = [project("demo-app", true), project(slug, false)];
      const response = await put(save(projects));

      expect(response.status).toBe(200);
      expect(commitProjects).toHaveBeenCalledWith(TOKEN, projects, SHA);
    });
  });

  describe("a good save", () => {
    it("commits exactly the parsed list with the page's sha, once, and answers with the list and the new sha", async () => {
      const projects = [{ ...project("demo-app", true), demoUrl: "https://example.com/demo/" }, project("tools", true), project("notes", false)];
      const response = await put(save(projects));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ projects, sha: NEW_SHA });
      expect(listRepos).toHaveBeenCalledTimes(1);
      expect(listRepos).toHaveBeenCalledWith(TOKEN);
      expect(commitProjects).toHaveBeenCalledTimes(1);
      expect(commitProjects).toHaveBeenCalledWith(TOKEN, projects, SHA);
    });

    it("keeps only the schema's keys, so an extra key sent by a client is never committed", async () => {
      await put(save([{ ...project("demo-app", true), extra: "x" } as Project]));
      expect(Object.keys(vi.mocked(commitProjects).mock.calls[0][1][0])).not.toContain("extra");
    });

    it("accepts an empty list", async () => {
      expect((await put(save([]))).status).toBe(200);
      expect(commitProjects).toHaveBeenCalledWith(TOKEN, [], SHA);
    });

    it("works behind the Vercel host with a port-less Origin", async () => {
      expect((await put(save([project("demo-app", true)]), { host: "pupo-admin.vercel.app", origin: "https://pupo-admin.vercel.app" })).status).toBe(200);
    });
  });

  describe("a failure", () => {
    it("answers 409 asking for a reload when the sha is stale, naming no GitHub detail", async () => {
      vi.mocked(commitProjects).mockRejectedValue(new ConflictError());
      const response = await put(save([project("demo-app", true)], "stale"));

      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/changed elsewhere, reload the page/);
    });

    it("answers 500 with GitHub's message for any other commit failure", async () => {
      vi.mocked(commitProjects).mockRejectedValue(new GitHubError(422, "Invalid request"));
      const response = await put(save([project("demo-app", true)]));

      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/422.*Invalid request/);
    });

    it("answers 500 when the repos can't be listed, and commits nothing", async () => {
      vi.mocked(listRepos).mockRejectedValue(new GitHubError(403, "rate limit"));
      const response = await put(save([project("demo-app", true)]));

      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/rate limit/);
      expect(commitProjects).not.toHaveBeenCalled();
    });

    it("never puts the token in an answer", async () => {
      vi.mocked(commitProjects).mockRejectedValue(new GitHubError(500, "boom"));
      for (const body of [save([project("demo-app", true)]), save([project("notes", true)]), "{not json"]) {
        expect(await (await put(body)).text()).not.toContain(TOKEN);
      }
    });
  });
});
