import { describe, expect, it } from "vitest";
import type { Project } from "../projects";
import { publishedButNotPublic } from "./publish";

// Made-up repos: the names of the real private ones must never appear in this public repo.
function project(slug: string, published: boolean): Project {
  return {
    slug,
    name: slug,
    tagline: "A tagline.",
    description: "A description.",
    tech: ["TypeScript"],
    repoUrl: `https://github.com/AmerPupo/${slug}`,
    published,
  };
}

const PUBLIC_REPOS = new Set(["demo-app", "tools"]);

describe("publishedButNotPublic", () => {
  it("accepts published projects whose repos are public", () => {
    expect(publishedButNotPublic([project("demo-app", true), project("tools", true)], PUBLIC_REPOS)).toEqual([]);
  });

  it("rejects a published project whose repo is private", () => {
    expect(publishedButNotPublic([project("demo-app", true), project("notes", true)], PUBLIC_REPOS)).toEqual(["notes"]);
  });

  // A renamed or deleted repo is missing from gh's list, and "unknown" must not pass as "public".
  it("rejects a published project whose repo is no longer listed", () => {
    expect(publishedButNotPublic([project("renamed-away", true)], PUBLIC_REPOS)).toEqual(["renamed-away"]);
  });

  it("accepts unpublished projects whatever their repo is, so they can still be saved and taken down", () => {
    const drafts = [project("notes", false), project("renamed-away", false), project("demo-app", false)];
    expect(publishedButNotPublic(drafts, PUBLIC_REPOS)).toEqual([]);
  });

  it("names every offender, in order", () => {
    const projects = [project("b-secret", true), project("demo-app", true), project("a-secret", true), project("c", false)];
    expect(publishedButNotPublic(projects, PUBLIC_REPOS)).toEqual(["b-secret", "a-secret"]);
  });

  it("accepts an empty list", () => {
    expect(publishedButNotPublic([], PUBLIC_REPOS)).toEqual([]);
  });

  it("rejects everything published when no repo is public", () => {
    expect(publishedButNotPublic([project("demo-app", true)], new Set())).toEqual(["demo-app"]);
  });
});
