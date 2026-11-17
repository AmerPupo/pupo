import { readFile } from "node:fs/promises";
import path from "node:path";

export type Project = {
  slug: string; // GitHub repo name; the page is /projects/<slug>
  name: string; // display title
  tagline: string; // one line for the carousel card, at most MAX_TAGLINE characters
  description: string; // plain text, paragraphs separated by a blank line
  tech: string[];
  repoUrl: string;
  demoUrl?: string; // absent when there is none, never ""
  published: boolean;
};

export const PROJECTS_FILE = path.join(process.cwd(), "content", "projects.json");
const MAX_TAGLINE = 100;

// The one repo-name rule. The admin routes reuse it before they hand a name to gh, git or claude.
export function isValidSlug(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value) && value !== "." && value !== "..";
}

export const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

// URLs end up as public links, so only http(s) passes (no javascript:, data: and so on).
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function fail(index: number, slug: unknown, problem: string): never {
  const named = typeof slug === "string" ? ` "${slug}"` : "";
  throw new Error(`projects.json entry ${index + 1}${named}: ${problem}`);
}

// Throws on any malformed entry, so a bad commit fails the build instead of shipping a broken page.
export function parseProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw)) throw new Error("projects.json must be an array of projects");
  const seen = new Set<string>();

  return raw.map((entry: unknown, index): Project => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail(index, undefined, "must be an object");
    }
    const { slug, name, tagline, description, tech, repoUrl, demoUrl, published } =
      entry as Record<string, unknown>;

    if (!isValidSlug(slug)) fail(index, slug, 'slug must be letters, digits, ".", "_" or "-" (not "." or "..")');
    if (seen.has(slug)) fail(index, slug, "duplicate slug");
    seen.add(slug);
    if (!isText(name)) fail(index, slug, "name must be a non-empty string");
    if (!isText(tagline)) fail(index, slug, "tagline must be a non-empty string");
    if (tagline.length > MAX_TAGLINE) {
      fail(index, slug, `tagline is ${tagline.length} characters, the limit is ${MAX_TAGLINE}`);
    }
    if (!isText(description)) fail(index, slug, "description must be a non-empty string");
    if (!Array.isArray(tech) || !tech.every(isText)) fail(index, slug, "tech must be an array of non-empty strings");
    if (!isHttpUrl(repoUrl)) fail(index, slug, "repoUrl must be an http(s) URL");
    if (demoUrl !== undefined && !isHttpUrl(demoUrl)) fail(index, slug, "demoUrl must be an http(s) URL, or absent");
    if (typeof published !== "boolean") fail(index, slug, "published must be true or false");

    return { slug, name, tagline, description, tech, repoUrl, demoUrl, published };
  });
}

// Read on every call (not imported as a JSON module), so an admin write shows up in dev without a restart.
export async function readProjects(): Promise<Project[]> {
  return parseProjects(JSON.parse(await readFile(PROJECTS_FILE, "utf8")));
}

export async function getPublishedProjects(): Promise<Project[]> {
  return (await readProjects()).filter((project) => project.published);
}
