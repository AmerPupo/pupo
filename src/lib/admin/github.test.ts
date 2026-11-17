import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneRepo, parseRepos } from "./github";

// cloneRepo deletes a folder and runs gh. Mocked, so a test of its guard can never touch the real disk,
// even if the guard were removed: the name ".." would otherwise delete os.tmpdir() itself.
vi.mock("node:fs/promises", () => ({ rm: vi.fn(async () => undefined) }));
vi.mock("node:child_process", () => ({
  // Fails through its callback, which is how promisify(execFile) reads the result, so a missing guard fails fast instead of hanging.
  execFile: vi.fn((...args: unknown[]) => (args.at(-1) as (error: Error) => void)(new Error("execFile is mocked"))),
}));

// What `gh repo list --json ...` prints for a public repo. The names are made up.
const PUBLIC = {
  name: "demo-app",
  visibility: "PUBLIC",
  primaryLanguage: { name: "TypeScript" },
  updatedAt: "2026-11-10T14:00:25Z",
  isFork: false,
  isArchived: false,
  url: "https://github.com/AmerPupo/demo-app",
  homepageUrl: "https://example.com/demo/",
};

// A private repo with no language yet and no homepage, which gh prints as null and "".
const PRIVATE = {
  ...PUBLIC,
  name: "notes",
  visibility: "PRIVATE",
  primaryLanguage: null,
  homepageUrl: "",
  url: "https://github.com/AmerPupo/notes",
};

// PUBLIC followed by a second repo that has `changes` applied, so the error has a position and a name to cite.
const withBadSecond = (changes: Record<string, unknown>) => [PUBLIC, { ...PUBLIC, name: "broken", ...changes }];

describe("parseRepos", () => {
  it("accepts what gh prints and keeps its order", () => {
    expect(parseRepos([PUBLIC, PRIVATE])).toEqual([PUBLIC, PRIVATE]);
  });

  it("accepts an empty list", () => {
    expect(parseRepos([])).toEqual([]);
  });

  it.each(["PUBLIC", "PRIVATE", "INTERNAL"])("accepts the visibility %s", (visibility) => {
    expect(parseRepos([{ ...PUBLIC, visibility }])[0].visibility).toBe(visibility);
  });

  it("rejects output that is not an array", () => {
    expect(() => parseRepos({ repos: [] })).toThrow(/array/);
  });

  it("rejects an entry that is not an object, naming its position", () => {
    expect(() => parseRepos([PUBLIC, "demo-app"])).toThrow(/entry 2.*object/);
  });

  it.each(Object.keys(PUBLIC))("rejects a repo with %s missing", (field) => {
    expect(() => parseRepos(withBadSecond({ [field]: undefined }))).toThrow(new RegExp(`entry 2.*${field}`));
  });

  // `visibility` decides what may be drafted or published, so anything gh could print that isn't a known value is an error, never a guess.
  it.each<[string, unknown]>([
    ["visibility", "public"],
    ["visibility", "SECRET"],
    ["visibility", true],
    ["primaryLanguage", "TypeScript"],
    ["primaryLanguage", {}],
    ["primaryLanguage", { name: 7 }],
    ["updatedAt", "yesterday"],
    ["updatedAt", 1731247225],
    ["isFork", "no"],
    ["isArchived", 0],
    ["url", ""],
    ["url", null],
    ["homepageUrl", null],
  ])("rejects %s set to %j", (field, value) => {
    expect(() => parseRepos(withBadSecond({ [field]: value }))).toThrow(new RegExp(`"broken".*${field}`));
  });

  it.each(["..", "a/b", "a b", ""])("rejects the repo name %j", (name) => {
    expect(() => parseRepos(withBadSecond({ name }))).toThrow(/entry 2.*name/);
  });
});

describe("cloneRepo", () => {
  beforeEach(() => vi.clearAllMocks());

  // The name becomes a folder that is deleted before the clone, so a bad one has to fail before gh runs or any file is touched.
  it.each(["", ".", "..", "../x", "a/b", "a\\b", "a b", "a\nb"])(
    "refuses the repo name %j before deleting anything or running gh",
    async (name) => {
      await expect(cloneRepo(name)).rejects.toThrow(/repo name/);
      expect(rm).not.toHaveBeenCalled();
      expect(execFile).not.toHaveBeenCalled();
    },
  );

  // --no-upstream stops gh from also fetching a fork's whole parent repo, and --depth 1 keeps the clone shallow.
  it("deletes the old clone, then runs gh with exactly the shallow-clone arguments, and returns the folder", async () => {
    // On a plain mock, promisify resolves with the callback's second argument.
    vi.mocked(execFile).mockImplementationOnce(((...args: unknown[]) =>
      (args.at(-1) as (error: null, result: unknown) => void)(null, { stdout: "", stderr: "" })) as never);

    const dir = await cloneRepo("demo-app");

    expect(dir).toBe(path.join(os.tmpdir(), "pupo-repos", "demo-app"));
    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith(dir, { recursive: true, force: true });
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execFile).mock.calls[0].slice(0, 2)).toEqual([
      "gh",
      ["repo", "clone", "AmerPupo/demo-app", dir, "--no-upstream", "--", "--depth", "1"],
    ]);
    // The old folder goes first. After the clone it would delete the fresh one.
    expect(vi.mocked(rm).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(execFile).mock.invocationCallOrder[0]);
  });

  it("lets a gh failure through", async () => {
    await expect(cloneRepo("demo-app")).rejects.toThrow("execFile is mocked");
  });
});
