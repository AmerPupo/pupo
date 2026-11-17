import { beforeEach, describe, expect, it, vi } from "vitest";
import { listRepos, type Repo } from "@/lib/admin/github";
import { writeProjects } from "@/lib/admin/writeProjects";
import type { Project } from "@/lib/projects";
import { PUT } from "./route.dev";

// The route decides what reaches content/projects.json, and so what the public site shows. gh and the file write are mocked, so a test
// that fails because a check was dropped can't touch the real file. Repo names are made up (the real private ones must not appear here).
vi.mock("@/lib/admin/github", () => ({ listRepos: vi.fn() }));
vi.mock("@/lib/admin/writeProjects", () => ({ writeProjects: vi.fn() }));

const ORIGIN = "http://127.0.0.1:3000";
const HOST = "127.0.0.1:3000";

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

// `origin: null` and `host: null` send no such header at all. A string body is sent as it is, so malformed JSON can be tested.
function put(body: unknown, origin: string | null = ORIGIN, host: string | null = HOST) {
  const headers: Record<string, string> = { "content-type": "application/json" };
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

const nothingRan = () => {
  expect(listRepos).not.toHaveBeenCalled();
  expect(writeProjects).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listRepos).mockResolvedValue([repo("demo-app"), repo("tools"), repo("notes", "PRIVATE"), repo("team-wiki", "INTERNAL")]);
  vi.mocked(writeProjects).mockResolvedValue(undefined);
});

describe("PUT /api/admin/projects", () => {
  describe("the Origin gate", () => {
    // The body is malformed on purpose: the gate answers before the body is even read.
    it.each<[string, string | null]>([
      ["no Origin", null],
      ["a foreign site", "https://example.com"],
      ["a look-alike host", "http://localhost.evil.com:3000"],
      ["no port", "http://localhost"],
    ])("answers 403 for %s, and nothing is listed or written", async (_, origin) => {
      const response = await put("{not json", origin);
      expect(response.status).toBe(403);
      expect((await response.json()).error).toMatch(/localhost/);
      nothingRan();
    });

    it.each(["http://localhost:3000", "http://127.0.0.1:3217"])("lets %s through", async (origin) => {
      expect((await put([project("demo-app", true)], origin)).status).toBe(200);
    });
  });

  // A page that rebinds its own DNS name to 127.0.0.1 is served under that name, so its Host is foreign even when an Origin looks local.
  describe("the Host gate", () => {
    it.each<[string, string | null]>([
      ["a foreign host", "evil.example:3000"],
      ["a look-alike host", "localhost.evil.com:3000"],
      ["no Host", null],
    ])("answers 403 for a local Origin with %s, and nothing is listed or written", async (_, host) => {
      const response = await put("{not json", ORIGIN, host);
      expect(response.status).toBe(403);
      nothingRan();
    });

    it.each(["localhost:3000", "127.0.0.1:3217"])("lets the host %s through", async (host) => {
      expect((await put([project("demo-app", true)], ORIGIN, host)).status).toBe(200);
    });
  });

  describe("a body parseProjects rejects", () => {
    it.each<[string, unknown, RegExp]>([
      ["malformed JSON", "{not json", /JSON/],
      ["a body that is not an array", { slug: "demo-app" }, /must be an array/],
      ["a missing name", [{ ...project("demo-app", true), name: undefined }], /entry 1 "demo-app": name/],
      ["a 101-character tagline", [{ ...project("demo-app", true), tagline: "x".repeat(101) }], /101 characters/],
      ["a duplicate slug", [project("demo-app", true), project("demo-app", false)], /duplicate slug/],
      ["a bad slug", [project("../x", false)], /slug must be/],
      ["a javascript: demo URL", [{ ...project("demo-app", true), demoUrl: "javascript:alert(1)" }], /demoUrl/],
    ])("answers 400 for %s, and nothing is listed or written", async (_, body, message) => {
      const response = await put(body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(message);
      nothingRan();
    });
  });

  describe("the publish guard", () => {
    // Only exactly PUBLIC counts. A private repo, an INTERNAL one and one gh doesn't list all fail closed, and the answer names them.
    it.each<[string, string]>([
      ["a private repo", "notes"],
      ["an INTERNAL repo", "team-wiki"],
      ["a repo that is not listed (renamed or deleted)", "renamed-away"],
    ])("answers 400 for a published entry whose repo is %s, and writes nothing", async (_, slug) => {
      const response = await put([project("demo-app", true), project(slug, true)]);

      expect(response.status).toBe(400);
      const { error } = await response.json();
      expect(error).toMatch(/Not saved/);
      expect(error).toContain(slug);
      expect(error).not.toContain("demo-app");
      expect(writeProjects).not.toHaveBeenCalled();
    });

    it("names every offender, and still writes nothing when only one of two is bad", async () => {
      const response = await put([project("notes", true), project("demo-app", true), project("team-wiki", true)]);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/notes, team-wiki/);
      expect(writeProjects).not.toHaveBeenCalled();
    });

    // That is how an entry of a deleted or private repo can still be taken down.
    it.each(["notes", "team-wiki", "renamed-away"])("accepts an unpublished entry whose repo is %s", async (slug) => {
      const projects = [project("demo-app", true), project(slug, false)];
      const response = await put(projects);

      expect(response.status).toBe(200);
      expect(writeProjects).toHaveBeenCalledTimes(1);
      expect(writeProjects).toHaveBeenCalledWith(projects);
    });
  });

  describe("a good save", () => {
    it("writes exactly the parsed list once and answers with it", async () => {
      const projects = [
        { ...project("demo-app", true), demoUrl: "https://example.com/demo/" },
        project("tools", true),
        project("notes", false),
      ];
      const response = await put(projects);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(projects);
      expect(listRepos).toHaveBeenCalledTimes(1);
      expect(writeProjects).toHaveBeenCalledTimes(1);
      expect(writeProjects).toHaveBeenCalledWith(projects);
    });

    it("keeps only the schema's keys, so an extra key sent by a client is never written", async () => {
      await put([{ ...project("demo-app", true), extra: "x" }]);
      expect(Object.keys(vi.mocked(writeProjects).mock.calls[0][0][0]).sort()).not.toContain("extra");
    });

    it("accepts an empty list", async () => {
      expect((await put([])).status).toBe(200);
      expect(writeProjects).toHaveBeenCalledWith([]);
    });
  });

  describe("a failure", () => {
    it("answers 500 with the message when gh can't list the repos, and writes nothing", async () => {
      vi.mocked(listRepos).mockRejectedValue(new Error("To get started with GitHub CLI, please run: gh auth login"));
      const response = await put([project("demo-app", true)]);

      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/gh auth login/);
      expect(writeProjects).not.toHaveBeenCalled();
    });

    it("answers 500 with the message when the file can't be written", async () => {
      vi.mocked(writeProjects).mockRejectedValue(new Error("EACCES: permission denied"));
      const response = await put([project("demo-app", true)]);

      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/EACCES/);
    });
  });
});
