import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "../projects";
import { writeProjects } from "./writeProjects";

const PROJECT: Project = {
  slug: "demo-app",
  name: "Demo app",
  tagline: "A tagline.",
  description: "First paragraph.\n\nSecond paragraph.",
  tech: ["TypeScript", "Next.js"],
  repoUrl: "https://github.com/AmerPupo/demo-app",
  published: true,
};

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pupo-write-"));
  file = path.join(dir, "projects.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("writeProjects", () => {
  it("writes the projects as 2-space JSON with a trailing newline", async () => {
    await writeProjects([PROJECT], file);
    expect(await readFile(file, "utf8")).toBe(`${JSON.stringify([PROJECT], null, 2)}\n`);
    expect(await readFile(file, "utf8")).toMatch(/^\[\n {2}\{\n {4}"slug": "demo-app",\n/);
  });

  it("replaces what the file held before", async () => {
    await writeFile(file, '["old content"]\n');
    await writeProjects([PROJECT], file);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual([PROJECT]);
  });

  it("leaves the key out when demoUrl is undefined, as the schema wants it absent", async () => {
    await writeProjects([{ ...PROJECT, demoUrl: undefined }], file);
    expect(await readFile(file, "utf8")).not.toContain("demoUrl");
  });

  it("writes an empty list as []", async () => {
    await writeProjects([], file);
    expect(await readFile(file, "utf8")).toBe("[]\n");
  });

  it("leaves nothing behind but the file itself", async () => {
    await writeProjects([PROJECT], file);
    await writeProjects([PROJECT, { ...PROJECT, slug: "tools" }], file);
    expect(await readdir(dir)).toEqual(["projects.json"]);
  });

  // A directory where the file should be makes the final rename fail, after the temp file was written.
  it("rejects, and cleans up its temp file, when the rename fails", async () => {
    await mkdir(path.join(file, "in-the-way"), { recursive: true });
    await expect(writeProjects([PROJECT], file)).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["projects.json"]);
    expect(await readdir(file)).toEqual(["in-the-way"]);
  });

  it("rejects when the folder does not exist, and creates nothing", async () => {
    const missing = path.join(dir, "no-such-folder", "projects.json");
    await expect(writeProjects([PROJECT], missing)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});
