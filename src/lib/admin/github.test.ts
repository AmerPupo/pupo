import { describe, expect, it } from "vitest";
import { parseRepos } from "./github";

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
