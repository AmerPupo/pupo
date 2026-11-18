import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateDraft } from "@/lib/admin/claude";
import { cloneRepo, listRepos as listLocalRepos, removeClone, type Repo } from "@/lib/admin/github";
import { dispatchDraft, findDraft, GitHubError, listRepos } from "@/lib/admin/remote";
import { SESSION_COOKIE, sealSession } from "@/lib/admin/session";
import { GET, POST } from "./route.dev";

// The admin project (ADMIN=1): POST starts a GitHub Actions run, GET asks how it is going. The session is real (sealed with a test key) and
// GitHub is mocked, so no test starts a run. The local-mode cases are in route.dev.test.ts and don't change. Repo names are made up.
vi.mock("@/lib/admin/github", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/github")>()),
  listRepos: vi.fn(),
  cloneRepo: vi.fn(),
  removeClone: vi.fn(),
}));
vi.mock("@/lib/admin/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/claude")>()),
  generateDraft: vi.fn(),
}));
vi.mock("@/lib/admin/remote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/remote")>()),
  listRepos: vi.fn(),
  dispatchDraft: vi.fn(),
  findDraft: vi.fn(),
}));

const TOKEN = "test-oauth-token-value";
const HOST = "pupo-admin.example";
const ORIGIN = `https://${HOST}`;
const ID = "2d5353c2-8075-448a-9866-e087b6fd185f";
const RUN_URL = "https://github.com/AmerPupo/pupo/actions/runs/44333477534";
const DRAFT = { name: "Demo App", tagline: "A demo.", description: "I built a demo.", tech: ["TypeScript"] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

const session = () => `${SESSION_COOKIE}=${sealSession({ login: "AmerPupo", token: TOKEN, exp: Date.now() + 60_000 })}`;

type Options = { cookie?: string | null; origin?: string | null; host?: string | null };

// `null` sends no such header at all. A string body is sent as it is, so malformed JSON can be tested.
function post(body: unknown, { cookie = session(), origin = ORIGIN, host = HOST }: Options = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie !== null) headers.cookie = cookie;
  if (origin !== null) headers.origin = origin;
  if (host !== null) headers.host = host;
  return POST(new Request(`${ORIGIN}/api/admin/draft`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

// A browser sends no Origin on a same-site GET, so the default has none.
function get(query: string, { cookie = session() }: { cookie?: string | null } = {}) {
  return GET(new Request(`${ORIGIN}/api/admin/draft${query}`, { headers: cookie === null ? {} : { cookie } }));
}
const poll = (id = ID, name = "demo-app") => get(`?id=${id}&name=${name}`);

const nothingRan = () => {
  expect(listRepos).not.toHaveBeenCalled();
  expect(dispatchDraft).not.toHaveBeenCalled();
  expect(findDraft).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ADMIN", "1");
  vi.stubEnv("SESSION_SECRET", Buffer.alloc(32, 7).toString("base64"));
  vi.mocked(listRepos).mockResolvedValue([repo("demo-app"), repo("notes", { visibility: "PRIVATE" }), repo("team-wiki", { visibility: "INTERNAL" })]);
  vi.mocked(dispatchDraft).mockResolvedValue(undefined);
  vi.mocked(findDraft).mockResolvedValue({ status: "done", draft: DRAFT });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/draft on the admin project", () => {
  // The gate runs first: a body that is malformed on purpose proves nothing was read or asked for before it answered.
  describe("the gate", () => {
    it.each<[string, string | null]>([
      ["no Origin", null],
      ["a foreign site", "https://example.com"],
      ["a look-alike host", `https://${HOST}.evil.com`],
      ["plain http", `http://${HOST}`],
      ["a local origin (this is not the local admin)", "http://127.0.0.1:3000"],
    ])("answers 403 for %s, and nothing is listed or dispatched", async (_, origin) => {
      expect((await post("{not json", { origin })).status).toBe(403);
      nothingRan();
    });

    it("answers 403 for a foreign Origin even when there is no session", async () => {
      expect((await post("{not json", { origin: "https://example.com", cookie: null })).status).toBe(403);
      nothingRan();
    });

    it.each<[string, () => string | null]>([
      ["no cookie", () => null],
      ["a garbage session", () => `${SESSION_COOKIE}=garbage`],
      ["an expired session", () => `${SESSION_COOKIE}=${sealSession({ login: "AmerPupo", token: TOKEN, exp: Date.now() - 1 })}`],
    ])("answers 401 for %s, and nothing is listed or dispatched", async (_, cookie) => {
      expect((await post("{not json", { cookie: cookie() })).status).toBe(401);
      nothingRan();
    });

    it("does not touch gh, a clone or claude on this machine, which belong to the local admin", async () => {
      expect((await post({ name: "demo-app" })).status).toBe(202);
      expect(listLocalRepos).not.toHaveBeenCalled();
      expect(cloneRepo).not.toHaveBeenCalled();
      expect(removeClone).not.toHaveBeenCalled();
      expect(generateDraft).not.toHaveBeenCalled();
    });
  });

  describe("a bad request", () => {
    it.each<[string, unknown]>([
      ["malformed JSON", "{not json"],
      ["a body that is not an object", ["demo-app"]],
      ["no name", {}],
      ["a name that is not a repo name", { name: "../x" }],
      ["a note that is not a string", { name: "demo-app", note: 5 }],
      ["a note over 500 characters", { name: "demo-app", note: "x".repeat(501) }],
    ])("answers 400 for %s, before GitHub is asked anything", async (_, body) => {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(typeof (await response.json()).error).toBe("string");
      nothingRan();
    });
  });

  describe("the repo check, before any dispatch", () => {
    it("answers 400 for a name that isn't listed", async () => {
      const response = await post({ name: "no-such-repo" });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/No repository named "no-such-repo"/);
      expect(dispatchDraft).not.toHaveBeenCalled();
    });

    it("matches the name exactly, not by case or prefix", async () => {
      for (const name of ["Demo-App", "demo", "demo-app2"]) expect((await post({ name })).status).toBe(400);
      expect(dispatchDraft).not.toHaveBeenCalled();
    });

    it.each<[string, string]>([
      ["PRIVATE", "notes"],
      ["INTERNAL", "team-wiki"],
    ])("answers 400 for a %s repo, and nothing is dispatched", async (visibility, name) => {
      const response = await post({ name });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(new RegExp(`${visibility.toLowerCase()}.*Only public`));
      expect(dispatchDraft).not.toHaveBeenCalled();
    });
  });

  describe("a public repo", () => {
    it("starts one run with the user's token and answers 202 with a fresh UUID", async () => {
      const response = await post({ name: "demo-app" });

      expect(response.status).toBe(202);
      const { id } = await response.json();
      expect(id).toMatch(UUID);
      expect(listRepos).toHaveBeenCalledTimes(1);
      expect(listRepos).toHaveBeenCalledWith(TOKEN);
      expect(dispatchDraft).toHaveBeenCalledTimes(1);
      expect(dispatchDraft).toHaveBeenCalledWith(TOKEN, "demo-app", undefined, id);
    });

    it("gives every request its own id", async () => {
      const first = (await (await post({ name: "demo-app" })).json()).id;
      const second = (await (await post({ name: "demo-app" })).json()).id;

      expect(first).not.toBe(second);
    });

    it("sends the trimmed note, and none for a blank one", async () => {
      await post({ name: "demo-app", note: "  focus on the backend  " });
      expect(dispatchDraft).toHaveBeenLastCalledWith(TOKEN, "demo-app", "focus on the backend", expect.any(String));

      await post({ name: "demo-app", note: "   " });
      expect(dispatchDraft).toHaveBeenLastCalledWith(TOKEN, "demo-app", undefined, expect.any(String));
    });

    it("accepts a note of exactly 500 characters", async () => {
      expect((await post({ name: "demo-app", note: "x".repeat(500) })).status).toBe(202);
    });
  });

  describe("a failure", () => {
    it("answers 500 with GitHub's message when the dispatch is refused", async () => {
      vi.mocked(dispatchDraft).mockRejectedValue(new GitHubError(422, "Workflow does not have 'workflow_dispatch' trigger"));
      const response = await post({ name: "demo-app" });

      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/422.*workflow_dispatch/);
    });

    it("answers 500 when the repos can't be listed, and dispatches nothing", async () => {
      vi.mocked(listRepos).mockRejectedValue(new GitHubError(403, "rate limit"));
      const response = await post({ name: "demo-app" });

      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/rate limit/);
      expect(dispatchDraft).not.toHaveBeenCalled();
    });

    it("never puts the token in an answer", async () => {
      vi.mocked(dispatchDraft).mockRejectedValue(new GitHubError(500, "boom"));
      for (const body of [{ name: "demo-app" }, { name: "notes" }, "{not json"]) {
        expect(await (await post(body)).text()).not.toContain(TOKEN);
      }
    });
  });
});

describe("GET /api/admin/draft on the admin project", () => {
  describe("the gate", () => {
    it.each<[string, () => string | null]>([
      ["no cookie", () => null],
      ["an unrelated cookie", () => "a=1"],
      ["a garbage session", () => `${SESSION_COOKIE}=garbage`],
      ["an expired session", () => `${SESSION_COOKIE}=${sealSession({ login: "AmerPupo", token: TOKEN, exp: Date.now() - 1 })}`],
    ])("answers 401 for %s, and GitHub is not asked", async (_, cookie) => {
      expect((await get(`?id=${ID}&name=demo-app`, { cookie: cookie() })).status).toBe(401);
      nothingRan();
    });

    it("asks nothing of the Origin: a browser sends none on a same-site GET", async () => {
      expect((await poll()).status).toBe(200);
    });
  });

  describe("a bad query", () => {
    it.each<[string, string, RegExp]>([
      ["no query", "", /id/],
      ["no id", "?name=demo-app", /id/],
      ["an empty id", "?id=&name=demo-app", /id/],
      ["an id that isn't a UUID", "?id=not-a-uuid&name=demo-app", /id/],
      ["an id with something after a UUID", `?id=${ID}x&name=demo-app`, /id/],
      ["an id with something before a UUID", `?id=x${ID}&name=demo-app`, /id/],
      ["no name", `?id=${ID}`, /name/],
      ["an empty name", `?id=${ID}&name=`, /name/],
      ["a name that isn't a repo name", `?id=${ID}&name=..`, /name/],
      ["a name with a slash", `?id=${ID}&name=a%2Fb`, /name/],
    ])("answers 400 for %s, and GitHub is not asked", async (_, query, message) => {
      const response = await get(query);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(message);
      nothingRan();
    });

    it("takes an upper-case UUID, which is what the workflow's own check takes", async () => {
      expect((await poll(ID.toUpperCase())).status).toBe(200);
      expect(findDraft).toHaveBeenCalledWith(TOKEN, ID.toUpperCase());
    });
  });

  describe("a run that is not finished", () => {
    it("answers 202 pending with no URL while the run isn't listed, and lists no repos", async () => {
      vi.mocked(findDraft).mockResolvedValue({ status: "pending" });
      const response = await poll();

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ status: "pending" });
      expect(listRepos).not.toHaveBeenCalled();
    });

    it("answers 202 pending with the run's URL once it exists", async () => {
      vi.mocked(findDraft).mockResolvedValue({ status: "pending", runUrl: RUN_URL });
      const response = await poll();

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ status: "pending", runUrl: RUN_URL });
    });
  });

  describe("a finished run", () => {
    it("answers 200 with the draft and the repo's links, asking for the run with the user's token", async () => {
      const response = await poll();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ...DRAFT, repoUrl: "https://github.com/AmerPupo/demo-app", demoUrl: "https://example.com/demo/" });
      expect(findDraft).toHaveBeenCalledWith(TOKEN, ID);
      expect(listRepos).toHaveBeenCalledWith(TOKEN);
    });

    // The homepage field is free text, and a value that isn't an http(s) URL would make Save fail.
    it.each(["", "example.com", "javascript:alert(1)", "ftp://example.com"])("leaves out demoUrl for the homepage %j", async (homepageUrl) => {
      vi.mocked(listRepos).mockResolvedValue([repo("demo-app", { homepageUrl })]);
      const response = await poll();

      expect(response.status).toBe(200);
      expect(await response.json()).not.toHaveProperty("demoUrl");
    });

    it.each<[string, Repo[], RegExp]>([
      ["went private since", [repo("demo-app", { visibility: "PRIVATE" })], /private.*Only public/],
      ["is no longer listed", [repo("other")], /No repository named "demo-app"/],
    ])("answers 400 and hands out no draft when the repo %s", async (_, repos, message) => {
      vi.mocked(listRepos).mockResolvedValue(repos);
      const response = await poll();

      expect(response.status).toBe(400);
      const text = await response.text();
      expect(JSON.parse(text).error).toMatch(message);
      expect(text).not.toContain(DRAFT.description);
    });
  });

  describe("a run that failed", () => {
    it("answers 500 with the reason and the run's URL", async () => {
      vi.mocked(findDraft).mockResolvedValue({ status: "failed", runUrl: RUN_URL, reason: "The run finished (failure) without a draft." });
      const response = await poll();

      expect(response.status).toBe(500);
      const { error } = await response.json();
      expect(error).toContain("The run finished (failure) without a draft.");
      expect(error).toContain(RUN_URL);
      expect(listRepos).not.toHaveBeenCalled();
    });

    it("keeps the URL last and unpunctuated, so the page can make it a link", async () => {
      vi.mocked(findDraft).mockResolvedValue({ status: "failed", runUrl: RUN_URL, reason: "The draft is invalid: tagline must be a non-empty string." });
      const { error } = await (await poll()).json();

      expect(error.endsWith(RUN_URL)).toBe(true);
    });
  });

  // A GitHub outage is worth asking again about, so it gets a status the page retries on. Anything else would fail the same way next time.
  describe("a GitHub failure", () => {
    it.each([500, 502, 503])("answers 502 when GitHub answers %s, so the page asks again", async (status) => {
      vi.mocked(findDraft).mockRejectedValue(new GitHubError(status, "unavailable"));
      const response = await poll();

      expect(response.status).toBe(502);
      expect((await response.json()).error).toMatch(new RegExp(`${status}.*unavailable`));
    });

    it.each([401, 403, 404])("answers 500 when GitHub answers %s, which asking again won't fix", async (status) => {
      vi.mocked(findDraft).mockRejectedValue(new GitHubError(status, "nope"));

      expect((await poll()).status).toBe(500);
    });

    it("answers 500 for an answer from GitHub that makes no sense", async () => {
      vi.mocked(findDraft).mockRejectedValue(new Error("GitHub's answer had no workflow_runs list."));
      const response = await poll();

      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/workflow_runs/);
    });

    it("answers 502 when the repos can't be listed after a finished run", async () => {
      vi.mocked(listRepos).mockRejectedValue(new GitHubError(503, "unavailable"));

      expect((await poll()).status).toBe(502);
    });

    it("never puts the token in an answer", async () => {
      vi.mocked(findDraft).mockRejectedValue(new GitHubError(500, "boom"));
      for (const query of [`?id=${ID}&name=demo-app`, "?id=bad&name=demo-app"]) {
        expect(await (await get(query)).text()).not.toContain(TOKEN);
      }
    });
  });
});

// The local admin has no run to ask about: its POST answers with the draft itself.
describe("GET /api/admin/draft on the local admin", () => {
  it("answers 404, and GitHub is not asked", async () => {
    vi.stubEnv("ADMIN", ""); // anything but "1"; the session key stays so the cookie can still be sealed

    expect((await poll()).status).toBe(404);
    nothingRan();
  });
});
