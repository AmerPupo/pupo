import { describe, expect, it } from "vitest";
import { MAX_NOTE, parseDraftRequest } from "./draftRequest";

describe("parseDraftRequest", () => {
  it("accepts a repo name with no note", () => {
    expect(parseDraftRequest({ name: "demo-app" })).toEqual({ name: "demo-app", note: undefined });
  });

  it("accepts a note and trims it", () => {
    expect(parseDraftRequest({ name: "demo-app", note: "  focus on the backend \n" })).toEqual({
      name: "demo-app",
      note: "focus on the backend",
    });
  });

  // The page sends "" when the note field is empty, and that must read as "no note".
  it.each(["", "   ", "\n\t"])("treats the note %j as no note", (note) => {
    expect(parseDraftRequest({ name: "demo-app", note }).note).toBeUndefined();
  });

  it("accepts a note of exactly the limit and rejects one character more, naming the length", () => {
    expect(MAX_NOTE).toBe(500);
    expect(parseDraftRequest({ name: "demo-app", note: "a".repeat(500) }).note).toHaveLength(500);
    expect(() => parseDraftRequest({ name: "demo-app", note: "a".repeat(501) })).toThrow(
      /note is 501 characters, the limit is 500/,
    );
  });

  it.each<[string, unknown]>([
    ["a number", 5],
    ["null", null],
    ["an array", ["focus"]],
    ["an object", { text: "focus" }],
  ])("rejects a note that is %s", (_, note) => {
    expect(() => parseDraftRequest({ name: "demo-app", note })).toThrow(/note must be a string/);
  });

  // The name goes to gh, to git and into a folder path, so it has to pass the same slug check as a project.
  it.each<[string, unknown]>([
    ["missing", undefined],
    ["a number", 7],
    ["null", null],
    ["empty", ""],
    ["a dot", "."],
    ["two dots", ".."],
    ["a path", "../etc"],
    ["a slash", "owner/repo"],
    ["a backslash", "a\\b"],
    ["a space", "demo app"],
    ["a newline", "demo\napp"],
    ["a git option with a value", "--upload-pack=evil"],
  ])("rejects a name that is %s", (_, name) => {
    expect(() => parseDraftRequest({ name })).toThrow(/name must be a repository name/);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "demo-app"],
    ["an array", [{ name: "demo-app" }]],
    ["a number", 5],
  ])("rejects a body that is %s", (_, body) => {
    expect(() => parseDraftRequest(body)).toThrow(/JSON object/);
  });

  it("ignores keys it does not know", () => {
    expect(parseDraftRequest({ name: "demo-app", published: true })).toEqual({ name: "demo-app", note: undefined });
  });
});
