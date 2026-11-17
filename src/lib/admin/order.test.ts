import { describe, expect, it } from "vitest";
import type { Project } from "../projects";
import { moveProject, upsertProject } from "./order";

function project(slug: string, published = true): Project {
  return {
    slug,
    name: slug,
    tagline: "A tagline.",
    description: "A description.",
    tech: [],
    repoUrl: `https://github.com/AmerPupo/${slug}`,
    published,
  };
}

const slugs = (projects: Project[] | null) => projects?.map((p) => p.slug);

describe("moveProject", () => {
  it("moves a project up, past the published project before it", () => {
    expect(slugs(moveProject([project("a"), project("b"), project("c")], "b", -1))).toEqual(["b", "a", "c"]);
  });

  it("moves a project down, past the published project after it", () => {
    expect(slugs(moveProject([project("a"), project("b"), project("c")], "b", 1))).toEqual(["a", "c", "b"]);
  });

  // The carousel shows published projects only, so a draft in between is not a step. It keeps its own slot.
  it("skips drafts, which stay where they are", () => {
    const projects = [project("a"), project("draft", false), project("b")];
    expect(slugs(moveProject(projects, "b", -1))).toEqual(["b", "draft", "a"]);
    expect(slugs(moveProject(projects, "a", 1))).toEqual(["b", "draft", "a"]);
  });

  it("skips several drafts in a row", () => {
    const projects = [project("a"), project("d1", false), project("d2", false), project("b")];
    expect(slugs(moveProject(projects, "b", -1))).toEqual(["b", "d1", "d2", "a"]);
  });

  it("returns null for the first published project going up, even with drafts above it", () => {
    expect(moveProject([project("a"), project("b")], "a", -1)).toBeNull();
    expect(moveProject([project("d", false), project("a"), project("b")], "a", -1)).toBeNull();
  });

  it("returns null for the last published project going down, even with drafts below it", () => {
    expect(moveProject([project("a"), project("b")], "b", 1)).toBeNull();
    expect(moveProject([project("a"), project("b"), project("d", false)], "b", 1)).toBeNull();
  });

  it("returns null for a project that is not published", () => {
    const projects = [project("a"), project("draft", false), project("b")];
    expect(moveProject(projects, "draft", -1)).toBeNull();
    expect(moveProject(projects, "draft", 1)).toBeNull();
  });

  it("returns null for an unknown slug and for an empty list", () => {
    expect(moveProject([project("a"), project("b")], "nope", 1)).toBeNull();
    expect(moveProject([], "a", 1)).toBeNull();
  });

  it("returns null for the only published project", () => {
    const projects = [project("d", false), project("a")];
    expect(moveProject(projects, "a", -1)).toBeNull();
    expect(moveProject(projects, "a", 1)).toBeNull();
  });

  it("returns a new array and leaves the input alone", () => {
    const projects = [project("a"), project("b")];
    const moved = moveProject(projects, "b", -1);
    expect(moved).not.toBe(projects);
    expect(slugs(projects)).toEqual(["a", "b"]);
  });
});

describe("upsertProject", () => {
  it("replaces the project with the same slug, in its own slot", () => {
    const edited = { ...project("b"), name: "Edited" };
    const result = upsertProject([project("a"), project("b"), project("c")], edited);
    expect(slugs(result)).toEqual(["a", "b", "c"]);
    expect(result[1].name).toBe("Edited");
  });

  // A draft that was just generated is not in the list yet. Replacing by slug alone would drop it, and the save would still look like it worked.
  it("appends a project that is not in the list", () => {
    const result = upsertProject([project("a"), project("b", false)], project("new", false));
    expect(slugs(result)).toEqual(["a", "b", "new"]);
  });

  it("appends to an empty list", () => {
    expect(slugs(upsertProject([], project("new", false)))).toEqual(["new"]);
  });

  it("does not change the list it is given", () => {
    const projects = [project("a")];
    upsertProject(projects, project("new", false));
    expect(slugs(projects)).toEqual(["a"]);
  });
});
