import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isValidSlug } from "../projects";

const execFileAsync = promisify(execFile);

const OWNER = "AmerPupo";
const VISIBILITIES = ["PUBLIC", "PRIVATE", "INTERNAL"] as const;

// The fields `gh repo list --json` prints, in gh's own shapes.
export type Repo = {
  name: string;
  visibility: (typeof VISIBILITIES)[number];
  primaryLanguage: { name: string } | null;
  updatedAt: string; // ISO 8601, UTC
  isFork: boolean;
  isArchived: boolean;
  url: string;
  homepageUrl: string; // "" when the repo has none
};

const isVisibility = (value: unknown): value is Repo["visibility"] =>
  (VISIBILITIES as readonly unknown[]).includes(value);

const isLanguage = (value: unknown): value is Repo["primaryLanguage"] =>
  value === null || (typeof value === "object" && typeof (value as { name?: unknown }).name === "string");

function fail(index: number, name: unknown, problem: string): never {
  const named = typeof name === "string" ? ` "${name}"` : "";
  throw new Error(`gh repo list entry ${index + 1}${named}: ${problem}`);
}

// `visibility` decides what may be drafted or published, so a value gh could print that isn't a known one is an error, never a guess.
export function parseRepos(raw: unknown): Repo[] {
  if (!Array.isArray(raw)) throw new Error("gh repo list must print an array of repos");

  return raw.map((entry: unknown, index): Repo => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail(index, undefined, "must be an object");
    }
    const { name, visibility, primaryLanguage, updatedAt, isFork, isArchived, url, homepageUrl } =
      entry as Record<string, unknown>;

    if (!isValidSlug(name)) fail(index, name, 'name must be letters, digits, ".", "_" or "-" (not "." or "..")');
    if (!isVisibility(visibility)) fail(index, name, `visibility must be ${VISIBILITIES.join(", ")}`);
    if (!isLanguage(primaryLanguage)) fail(index, name, "primaryLanguage must be null or an object with a name");
    if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) {
      fail(index, name, "updatedAt must be a date string");
    }
    if (typeof isFork !== "boolean") fail(index, name, "isFork must be true or false");
    if (typeof isArchived !== "boolean") fail(index, name, "isArchived must be true or false");
    if (typeof url !== "string" || url === "") fail(index, name, "url must be a non-empty string");
    if (typeof homepageUrl !== "string") fail(index, name, "homepageUrl must be a string");

    return { name, visibility, primaryLanguage, updatedAt, isFork, isArchived, url, homepageUrl };
  });
}

// Arguments go to execFile as an array, never through a shell. gh lists only 30 repos unless --limit says more.
export async function listRepos(): Promise<Repo[]> {
  const { stdout } = await execFileAsync("gh", [
    "repo",
    "list",
    OWNER,
    "--limit",
    "1000",
    "--json",
    "name,visibility,primaryLanguage,updatedAt,isFork,isArchived,url,homepageUrl",
  ]);
  return parseRepos(JSON.parse(stdout));
}
