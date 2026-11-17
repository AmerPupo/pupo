import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDraft } from "@/lib/admin/claude";
import { cloneRepo, listRepos, type Repo } from "@/lib/admin/github";
import { POST } from "./route.dev";

// The route is the gate in front of a paid run: it must refuse before anything is listed, cloned or run. gh and claude are mocked, so a
// test that fails because a check was dropped can't start a real clone or model call. Repo names are made up (the real private ones
// must not appear in this public repo).
vi.mock("@/lib/admin/github", () => ({ listRepos: vi.fn(), cloneRepo: vi.fn() }));
vi.mock("@/lib/admin/claude", () => ({ generateDraft: vi.fn() }));

const ORIGIN = "http://127.0.0.1:3000";
const HOST = "127.0.0.1:3000";
const CLONE = "/tmp/pupo-repos/demo-app";
const DRAFT = { name: "Demo App", tagline: "A demo.", description: "I built a demo.", tech: ["TypeScript"] };

const repo = (name: string, changes: Partial<Repo> = {}): Repo => ({
  name,
  visibility: "PUBLIC",
  primaryLanguage: { name: "TypeScript" },
  updatedAt: "2026-11-10T14:00:25Z",
  isFork: false,
  isArchived: false,
  url: `https://github.com/AmerPupo/${name}`,
  homepageUrl: "https://example.com/demo/",
  ...changes,
});

// `origin: null` and `host: null` send no such header at all. A string body is sent as it is, so malformed JSON can be tested.
function post(body: unknown, origin: string | null = ORIGIN, host: string | null = HOST) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin !== null) headers.origin = origin;
  if (host !== null) headers.host = host;
  return POST(
    new Request(`${ORIGIN}/api/admin/draft`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const nothingRan = () => {
  expect(listRepos).not.toHaveBeenCalled();
  expect(cloneRepo).not.toHaveBeenCalled();
  expect(generateDraft).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listRepos).mockResolvedValue([repo("demo-app"), repo("notes", { visibility: "PRIVATE" })]);
  vi.mocked(cloneRepo).mockResolvedValue(CLONE);
  vi.mocked(generateDraft).mockResolvedValue(DRAFT);
});

describe("POST /api/admin/draft", () => {
  describe("the Origin gate", () => {
    // The body is malformed on purpose: the gate answers before the body is even read.
    it.each<[string, string | null]>([
      ["no Origin", null],
      ["a foreign site", "https://example.com"],
      ["a look-alike host", "http://localhost.evil.com:3000"],
      ["no port", "http://localhost"],
    ])("answers 403 for %s, and nothing else runs", async (_, origin) => {
      const response = await post("{not json", origin);
      expect(response.status).toBe(403);
      expect((await response.json()).error).toMatch(/localhost/);
      nothingRan();
    });

    it.each(["http://localhost:3000", "http://127.0.0.1:3217"])("lets %s through", async (origin) => {
      expect((await post({ name: "demo-app" }, origin)).status).toBe(200);
    });
  });

  // A page that rebinds its own DNS name to 127.0.0.1 is served under that name, so its Host is foreign even when an Origin looks local.
  describe("the Host gate", () => {
    it.each<[string, string | null]>([
      ["a foreign host", "evil.example:3000"],
      ["a look-alike host", "localhost.evil.com:3000"],
      ["no Host", null],
    ])("answers 403 for a local Origin with %s, and nothing else runs", async (_, host) => {
      const response = await post("{not json", ORIGIN, host);
      expect(response.status).toBe(403);
      nothingRan();
    });

    it.each(["localhost:3000", "127.0.0.1:3217"])("lets the host %s through", async (host) => {
      expect((await post({ name: "demo-app" }, ORIGIN, host)).status).toBe(200);
    });
  });

  describe("a bad request", () => {
    it.each<[string, unknown]>([
      ["malformed JSON", "{not json"],
      ["a body that is not an object", ["demo-app"]],
      ["no name", {}],
      ["a name that is not a repo name", { name: "../x" }],
      ["a name that is a dot", { name: ".." }],
      ["a note that is not a string", { name: "demo-app", note: 5 }],
      ["a note over 500 characters", { name: "demo-app", note: "x".repeat(501) }],
    ])("answers 400 for %s, before gh is asked anything", async (_, body) => {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(typeof (await response.json()).error).toBe("string");
      nothingRan();
    });

    it("accepts a note of exactly 500 characters", async () => {
      expect((await post({ name: "demo-app", note: "x".repeat(500) })).status).toBe(200);
    });
  });

  describe("the repo check, before any clone", () => {
    it("answers 400 for a name that gh does not list", async () => {
      const response = await post({ name: "no-such-repo" });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/No repository named "no-such-repo"/);
      expect(cloneRepo).not.toHaveBeenCalled();
      expect(generateDraft).not.toHaveBeenCalled();
    });

    it("matches the name exactly, not by case or prefix", async () => {
      for (const name of ["Demo-App", "demo", "demo-app2"]) {
        expect((await post({ name })).status).toBe(400);
      }
      expect(cloneRepo).not.toHaveBeenCalled();
    });

    // Only exactly PUBLIC passes. INTERNAL is not private, and still not public.
    it.each(["PRIVATE", "INTERNAL"] as const)("answers 400 for a %s repo, and nothing is cloned or run", async (visibility) => {
      vi.mocked(listRepos).mockResolvedValue([repo("notes", { visibility })]);
      const response = await post({ name: "notes" });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(new RegExp(`${visibility.toLowerCase()}.*Only public`));
      expect(cloneRepo).not.toHaveBeenCalled();
      expect(generateDraft).not.toHaveBeenCalled();
    });
  });

  describe("a public repo", () => {
    it("clones it, runs claude in the clone and answers with the draft plus the repo's links", async () => {
      const response = await post({ name: "demo-app" });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ...DRAFT,
        repoUrl: "https://github.com/AmerPupo/demo-app",
        demoUrl: "https://example.com/demo/",
      });
      expect(cloneRepo).toHaveBeenCalledWith("demo-app");
      expect(generateDraft).toHaveBeenCalledWith(CLONE, undefined);
    });

    it("passes the trimmed note to claude, and none for a blank one", async () => {
      await post({ name: "demo-app", note: "  focus on the backend  " });
      expect(generateDraft).toHaveBeenLastCalledWith(CLONE, "focus on the backend");

      await post({ name: "demo-app", note: "   " });
      expect(generateDraft).toHaveBeenLastCalledWith(CLONE, undefined);
    });

    // The homepage field is free text, and a value that isn't an http(s) URL would make Save fail.
    it.each(["", "example.com", "javascript:alert(1)", "ftp://example.com"])("leaves out demoUrl for the homepage %j", async (homepageUrl) => {
      vi.mocked(listRepos).mockResolvedValue([repo("demo-app", { homepageUrl })]);
      const response = await post({ name: "demo-app" });
      expect(response.status).toBe(200);
      expect(await response.json()).not.toHaveProperty("demoUrl");
    });
  });

  describe("a failure", () => {
    it("answers 500 with the message when gh can't list the repos", async () => {
      vi.mocked(listRepos).mockRejectedValue(new Error("To get started with GitHub CLI, please run: gh auth login"));
      const response = await post({ name: "demo-app" });
      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/gh auth login/);
      expect(cloneRepo).not.toHaveBeenCalled();
    });

    it("answers 500 with the message when the clone fails", async () => {
      vi.mocked(cloneRepo).mockRejectedValue(new Error("clone failed: repository not found"));
      const response = await post({ name: "demo-app" });
      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/repository not found/);
      expect(generateDraft).not.toHaveBeenCalled();
    });

    it("answers 500 with the message when claude fails or times out", async () => {
      vi.mocked(generateDraft).mockRejectedValue(new Error("claude timed out after 5 minutes and was stopped."));
      const response = await post({ name: "demo-app" });
      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/timed out/);
    });
  });
});
