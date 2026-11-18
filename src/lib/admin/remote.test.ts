import { afterEach, describe, expect, it, vi } from "vitest";
import { parseProjects, type Project } from "../projects";
import contentsFixture from "./fixtures/github/contents-projects.json";
import userReposFixture from "./fixtures/github/user-repos.json";
import { ConflictError, GitHubError, commitProjects, gh, listRepos, readProjectsFile } from "./remote";

// The fixtures are real GitHub responses with every repo name and value made up (see make-fixtures in the Task 15 notes), so a field GitHub
// renames shows up here. fetch is stubbed: no test reaches github.com or sends a token.
const TOKEN = "test-oauth-token-value";

type Reply = { status?: number; body: unknown } | Error;

// `routes` maps a path (everything after https://api.github.com) to its reply. A path with no route fails the test.
function stubGitHub(routes: Record<string, Reply>) {
  const mock = vi.fn<typeof fetch>(async (input) => {
    const path = String(input).replace("https://api.github.com", "");
    const reply = routes[path] ?? new Error(`unexpected fetch ${path}`);
    if (reply instanceof Error) throw reply;
    return Response.json(reply.body, { status: reply.status ?? 200 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const reposPath = (page: number) => `/user/repos?affiliation=owner&sort=pushed&per_page=100&page=${page}`;
const CONTENTS_PATH = "/repos/AmerPupo/pupo/contents/content/projects.json?ref=main";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gh", () => {
  it("sends the token, the media type and the API version", async () => {
    const mock = stubGitHub({ "/user": { body: { login: "x" } } });
    await gh(TOKEN, "/user");

    const headers = new Headers((mock.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("accept")).toBe("application/vnd.github+json");
    expect(headers.get("x-github-api-version")).toBe("2022-11-28");
  });

  it("throws a GitHubError with the status, and never puts the token in the message", async () => {
    stubGitHub({ "/user": { status: 401, body: { message: "Bad credentials" } } });
    const error = await gh(TOKEN, "/user").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(401);
    expect((error as GitHubError).message).toContain("401");
    expect((error as GitHubError).message).toContain("Bad credentials");
    expect((error as GitHubError).message).not.toContain(TOKEN);
  });

  it("cuts a long error body", async () => {
    stubGitHub({ "/user": { status: 500, body: "x".repeat(5000) } });
    const error = (await gh(TOKEN, "/user").catch((e: unknown) => e)) as GitHubError;

    expect(error.message.length).toBeLessThan(300);
  });

  it("returns undefined for a 204", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    expect(await gh(TOKEN, "/x", { method: "DELETE" })).toBeUndefined();
  });
});

describe("listRepos", () => {
  it("maps GitHub's REST shape into the repo shape the admin uses", async () => {
    stubGitHub({ [reposPath(1)]: { body: userReposFixture } });

    expect(await listRepos(TOKEN)).toEqual([
      {
        name: "demo-app",
        visibility: "PUBLIC",
        primaryLanguage: { name: "TypeScript" },
        updatedAt: "2026-11-10T14:00:25Z",
        isFork: false,
        isArchived: false,
        url: "https://github.com/AmerPupo/demo-app",
        homepageUrl: "https://demo.example.org",
      },
      {
        name: "secret-notes",
        visibility: "PRIVATE",
        primaryLanguage: null, // language: null
        updatedAt: "2026-10-02T08:30:00Z",
        isFork: false,
        isArchived: false,
        url: "https://github.com/AmerPupo/secret-notes",
        homepageUrl: "", // homepage: null
      },
      {
        name: "old-fork",
        visibility: "PUBLIC",
        primaryLanguage: { name: "C#" },
        updatedAt: "2025-03-21T19:45:10Z",
        isFork: true,
        isArchived: true,
        url: "https://github.com/AmerPupo/old-fork",
        homepageUrl: "", // homepage: ""
      },
    ]);
  });

  it("asks for the user's own repos, newest push first, with the user's token", async () => {
    const mock = stubGitHub({ [reposPath(1)]: { body: [] } });
    await listRepos(TOKEN);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe(`https://api.github.com${reposPath(1)}`);
    expect(new Headers((mock.mock.calls[0][1] as RequestInit).headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("returns an empty list for an account with no repos", async () => {
    stubGitHub({ [reposPath(1)]: { body: [] } });

    expect(await listRepos(TOKEN)).toEqual([]);
  });

  // gh stops at its --limit, GitHub at 100 per page, so the list has to follow the pages.
  it("reads every page until one comes back short, in order", async () => {
    const template = userReposFixture[0];
    const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ ...template, name: `repo-${from + i}` }));
    const mock = stubGitHub({
      [reposPath(1)]: { body: page(0, 100) },
      [reposPath(2)]: { body: page(100, 100) },
      [reposPath(3)]: { body: page(200, 7) },
    });
    const repos = await listRepos(TOKEN);

    expect(mock).toHaveBeenCalledTimes(3);
    expect(repos).toHaveLength(207);
    expect(repos.map((repo) => repo.name)).toEqual(Array.from({ length: 207 }, (_, i) => `repo-${i}`));
  });

  it("asks for another page when the first holds exactly 100", async () => {
    const template = userReposFixture[0];
    const mock = stubGitHub({
      [reposPath(1)]: { body: Array.from({ length: 100 }, (_, i) => ({ ...template, name: `repo-${i}` })) },
      [reposPath(2)]: { body: [] },
    });

    expect(await listRepos(TOKEN)).toHaveLength(100);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  // visibility decides what may be drafted or published, so anything that isn't a known value is an error, never a guess.
  it.each<[string, unknown]>([
    ["an unknown visibility", "secret"],
    ["no visibility", undefined],
    ["a numeric visibility", 1],
  ])("rejects %s", async (_, visibility) => {
    stubGitHub({ [reposPath(1)]: { body: [{ ...userReposFixture[0], visibility }] } });

    await expect(listRepos(TOKEN)).rejects.toThrow(/visibility/);
  });

  it("upper-cases a lower-case visibility, and so accepts internal", async () => {
    stubGitHub({ [reposPath(1)]: { body: [{ ...userReposFixture[0], visibility: "internal" }] } });

    expect((await listRepos(TOKEN))[0].visibility).toBe("INTERNAL");
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["a name that isn't a repo name", { name: "../x" }, /name/],
    ["a numeric language", { language: 5 }, /primaryLanguage/],
    ["a non-boolean fork", { fork: "no" }, /isFork/],
    ["a non-boolean archived", { archived: null }, /isArchived/],
    ["a missing html_url", { html_url: undefined }, /url/],
    ["a bad update time", { updated_at: "yesterday" }, /updatedAt/],
    ["a numeric homepage", { homepage: 5 }, /homepageUrl/],
  ])("rejects %s, naming the field", async (_, change, message) => {
    stubGitHub({ [reposPath(1)]: { body: [{ ...userReposFixture[0], ...change }] } });

    await expect(listRepos(TOKEN)).rejects.toThrow(message);
  });

  it.each<[string, unknown]>([
    ["an object", { message: "x" }],
    ["null", null],
    ["a string", "[]"],
  ])("rejects %s instead of a list", async (_, body) => {
    stubGitHub({ [reposPath(1)]: { body } });

    await expect(listRepos(TOKEN)).rejects.toThrow(/array/);
  });

  it("rejects an entry that isn't an object", async () => {
    stubGitHub({ [reposPath(1)]: { body: [null] } });

    await expect(listRepos(TOKEN)).rejects.toThrow(/object/);
  });

  it("passes GitHub's 401 on as a GitHubError, so the page can ask for a new sign-in", async () => {
    stubGitHub({ [reposPath(1)]: { status: 401, body: { message: "Bad credentials" } } });
    const error = await listRepos(TOKEN).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(401);
  });

  it("fails the whole list when a later page fails, instead of returning half of it", async () => {
    const template = userReposFixture[0];
    stubGitHub({
      [reposPath(1)]: { body: Array.from({ length: 100 }, (_, i) => ({ ...template, name: `repo-${i}` })) },
      [reposPath(2)]: { status: 502, body: "bad gateway" },
    });

    await expect(listRepos(TOKEN)).rejects.toThrow(/502/);
  });
});

describe("readProjectsFile", () => {
  it("decodes the file and returns it with its sha", async () => {
    stubGitHub({ [CONTENTS_PATH]: { body: contentsFixture } });
    const { projects, sha } = await readProjectsFile(TOKEN);

    expect(sha).toBe(contentsFixture.sha);
    expect(projects.map((p) => [p.slug, p.published])).toEqual([
      ["demo-app", true],
      ["tools", true],
      ["old-fork", false],
    ]);
    expect(projects[0]).toMatchObject({ name: "Demo App", demoUrl: "https://demo.example.org", tech: ["TypeScript", "Next.js"] });
    expect(projects[0].description).toContain("\n\n"); // the paragraphs survive the base64 round trip
  });

  it("reads main of the pupo repo, with the user's token", async () => {
    const mock = stubGitHub({ [CONTENTS_PATH]: { body: contentsFixture } });
    await readProjectsFile(TOKEN);

    expect(mock.mock.calls[0][0]).toBe(`https://api.github.com${CONTENTS_PATH}`);
    expect(new Headers((mock.mock.calls[0][1] as RequestInit).headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("decodes UTF-8 (the name has accents)", async () => {
    const text = JSON.stringify([{ ...JSON.parse(Buffer.from(contentsFixture.content, "base64").toString("utf8"))[0], name: "Jašarević Đ" }]);
    stubGitHub({ [CONTENTS_PATH]: { body: { ...contentsFixture, content: Buffer.from(text, "utf8").toString("base64") } } });

    expect((await readProjectsFile(TOKEN)).projects[0].name).toBe("Jašarević Đ");
  });

  it.each<[string, Record<string, unknown>]>([
    ["no sha", { sha: undefined }],
    ["an empty sha", { sha: "" }],
    ["a numeric sha", { sha: 5 }],
    ["no content", { content: undefined }],
    ["content that isn't a string", { content: [1] }],
    ["an encoding other than base64 (a file over 1 MB)", { encoding: "none", content: "" }],
    ["no encoding", { encoding: undefined }],
  ])("rejects %s", async (_, change) => {
    stubGitHub({ [CONTENTS_PATH]: { body: { ...contentsFixture, ...change } } });

    await expect(readProjectsFile(TOKEN)).rejects.toThrow(/base64 file with a sha/);
  });

  it("rejects a directory listing (an array) instead of a file", async () => {
    stubGitHub({ [CONTENTS_PATH]: { body: [contentsFixture] } });

    await expect(readProjectsFile(TOKEN)).rejects.toThrow(/base64 file with a sha/);
  });

  it("rejects a file that isn't JSON", async () => {
    stubGitHub({ [CONTENTS_PATH]: { body: { ...contentsFixture, content: Buffer.from("not json").toString("base64") } } });

    await expect(readProjectsFile(TOKEN)).rejects.toThrow();
  });

  it("rejects projects that parseProjects refuses, naming the entry", async () => {
    const bad = JSON.stringify([{ slug: "demo-app", name: "x" }]);
    stubGitHub({ [CONTENTS_PATH]: { body: { ...contentsFixture, content: Buffer.from(bad).toString("base64") } } });

    await expect(readProjectsFile(TOKEN)).rejects.toThrow(/demo-app/);
  });

  it("passes a 404 and a 401 on as GitHubErrors", async () => {
    for (const status of [404, 401]) {
      stubGitHub({ [CONTENTS_PATH]: { status, body: { message: "x" } } });
      const error = await readProjectsFile(TOKEN).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(GitHubError);
      expect((error as GitHubError).status).toBe(status);
    }
  });
});

describe("commitProjects", () => {
  const PUT_PATH = "/repos/AmerPupo/pupo/contents/content/projects.json";
  const NEW_SHA = "9f2c1d0e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e";
  // The documented shape of the answer to a Contents PUT (the file's new blob under content, and the commit). Not captured from GitHub,
  // because a capture would be a real commit on main. The first real save from the phone is the check.
  const putReply = { content: { name: "projects.json", path: "content/projects.json", sha: NEW_SHA }, commit: { sha: "c0ffee", message: "x" } };
  const fixtureText = Buffer.from(contentsFixture.content, "base64").toString("utf8");
  const projects = parseProjects(JSON.parse(fixtureText));

  const sentBody = (mock: ReturnType<typeof stubGitHub>) => JSON.parse(String((mock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;
  const decoded = (body: Record<string, unknown>) => Buffer.from(String(body.content), "base64").toString("utf8");

  it("PUTs the file to main of the pupo repo with the user's token, and returns the new sha", async () => {
    const mock = stubGitHub({ [PUT_PATH]: { body: putReply } });
    const sha = await commitProjects(TOKEN, projects, contentsFixture.sha);

    expect(sha).toBe(NEW_SHA);
    expect(mock).toHaveBeenCalledTimes(1);
    const init = mock.mock.calls[0][1] as RequestInit;
    expect(mock.mock.calls[0][0]).toBe(`https://api.github.com${PUT_PATH}`);
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("sends the page's sha, the branch and the commit message, and no author (so GitHub uses the signed-in user)", async () => {
    const mock = stubGitHub({ [PUT_PATH]: { body: putReply } });
    await commitProjects(TOKEN, projects, contentsFixture.sha);

    const body = sentBody(mock);
    expect(body.sha).toBe(contentsFixture.sha);
    expect(body.branch).toBe("main");
    expect(body.message).toBe("content: update projects (admin)");
    expect(Object.keys(body).sort()).toEqual(["branch", "content", "message", "sha"]);
  });

  // The file on main is what writeProjects wrote: 2-space JSON and a trailing newline. Same bytes here, so a save changes only the lines that changed.
  it("writes the same bytes as the file on main, so an unchanged list is an unchanged file", async () => {
    const mock = stubGitHub({ [PUT_PATH]: { body: putReply } });
    await commitProjects(TOKEN, projects, contentsFixture.sha);

    expect(decoded(sentBody(mock))).toBe(fixtureText);
  });

  it("encodes UTF-8 (the name has accents)", async () => {
    const mock = stubGitHub({ [PUT_PATH]: { body: putReply } });
    const accented: Project[] = [{ ...projects[0], name: "Jašarević Đ" }];
    await commitProjects(TOKEN, accented, contentsFixture.sha);

    expect(JSON.parse(decoded(sentBody(mock)))[0].name).toBe("Jašarević Đ");
  });

  it("turns GitHub's 409 (a stale sha) into a ConflictError", async () => {
    stubGitHub({ [PUT_PATH]: { status: 409, body: { message: "content/projects.json does not match abc" } } });
    const error = await commitProjects(TOKEN, projects, "stale").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).not.toBeInstanceOf(GitHubError);
  });

  it.each([401, 403, 404, 422, 500])("passes a %s on as a GitHubError, not as a conflict", async (status) => {
    stubGitHub({ [PUT_PATH]: { status, body: { message: "nope" } } });
    const error = await commitProjects(TOKEN, projects, contentsFixture.sha).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(status);
    expect((error as GitHubError).message).not.toContain(TOKEN);
  });

  it.each<[string, unknown]>([
    ["no content", {}],
    ["no sha", { content: {} }],
    ["an empty sha", { content: { sha: "" } }],
    ["a numeric sha", { content: { sha: 5 } }],
    ["a body that isn't an object", null],
  ])("fails when GitHub's answer has %s, since the next save would need that sha", async (_, body) => {
    stubGitHub({ [PUT_PATH]: { body } });

    await expect(commitProjects(TOKEN, projects, contentsFixture.sha)).rejects.toThrow(/new sha/);
  });
});
