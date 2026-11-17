import { describe, expect, it } from "vitest";
import { isValidSlug, parseProjects } from "./projects";

// A complete valid entry. Each test copies it and breaks one thing.
const VALID = {
  slug: "CareFall",
  name: "CareFall",
  tagline: "Fall detection on an ESP8266.",
  description: "First paragraph.\n\nSecond paragraph.",
  tech: ["C++", "Firebase"],
  repoUrl: "https://github.com/AmerPupo/CareFall",
  published: true,
};

// VALID followed by a second entry that has `changes` applied, so the error has a position and a slug to name.
const withBadSecond = (changes: Record<string, unknown>) => [VALID, { ...VALID, slug: "broken", ...changes }];

describe("parseProjects", () => {
  it("accepts valid entries and keeps their order", () => {
    const second = {
      ...VALID,
      slug: "portfolio",
      demoUrl: "https://amerpupo.github.io/portfolio/",
      published: false,
    };

    expect(parseProjects([VALID, second])).toEqual([VALID, second]);
  });

  it("accepts an empty list", () => {
    expect(parseProjects([])).toEqual([]);
  });

  it("rejects JSON that is not an array", () => {
    expect(() => parseProjects({ projects: [] })).toThrow(/array/);
  });

  it("rejects an entry that is not an object, naming its position", () => {
    expect(() => parseProjects([VALID, "CareFall"])).toThrow(/entry 2.*object/);
  });

  it.each(["slug", "name", "tagline", "description", "tech", "repoUrl", "published"])(
    "rejects an entry with %s missing",
    (field) => {
      expect(() => parseProjects(withBadSecond({ [field]: undefined }))).toThrow(
        new RegExp(`entry 2.*${field}`),
      );
    },
  );

  it.each<[string, unknown]>([
    ["name", 42],
    ["tagline", null],
    ["description", ["a", "b"]],
    ["tech", "C++"],
    ["tech", ["C++", 7]],
    ["repoUrl", 12],
    ["published", "yes"],
  ])("rejects %s set to %j", (field, value) => {
    expect(() => parseProjects(withBadSecond({ [field]: value }))).toThrow(
      new RegExp(`"broken".*${field}`),
    );
  });

  it("rejects a duplicate slug, naming it", () => {
    expect(() => parseProjects([VALID, { ...VALID, name: "Copy" }])).toThrow(
      /entry 2 "CareFall".*duplicate/,
    );
  });

  it.each(["..", "a/b", ""])("rejects the slug %j", (slug) => {
    expect(() => parseProjects(withBadSecond({ slug }))).toThrow(/entry 2.*slug/);
  });

  it("accepts a tagline of exactly 100 characters", () => {
    expect(() => parseProjects(withBadSecond({ tagline: "x".repeat(100) }))).not.toThrow();
  });

  it("rejects a tagline over 100 characters", () => {
    expect(() => parseProjects(withBadSecond({ tagline: "x".repeat(101) }))).toThrow(
      /"broken".*tagline.*100/,
    );
  });

  describe.each(["repoUrl", "demoUrl"])("%s", (field) => {
    it.each(["javascript:alert(1)", "ftp://example.com/repo", "github.com/AmerPupo/CareFall", ""])(
      "rejects %j",
      (url) => {
        expect(() => parseProjects(withBadSecond({ [field]: url }))).toThrow(
          new RegExp(`"broken".*${field}`),
        );
      },
    );

    it("accepts http and https URLs", () => {
      expect(() => parseProjects(withBadSecond({ [field]: "http://example.com/a" }))).not.toThrow();
      expect(() => parseProjects(withBadSecond({ [field]: "https://example.com/a" }))).not.toThrow();
    });
  });
});

describe("isValidSlug", () => {
  it.each(["CareFall", "my.repo", "snake_case", "kebab-case-2", "v1.2.3"])("accepts %j", (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each(["", ".", "..", "a/b", "..\\x", "a b", "naïve", "line\n", 42, null])("rejects %j", (slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });
});
