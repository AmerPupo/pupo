import { parseProjects, serializeProjects, type Project } from "../projects";
import { OWNER, parseRepos, type Repo } from "./github";

const API = "https://api.github.com";
const REPO = "pupo";
const BRANCH = "main";
const PROJECTS_PATH = "content/projects.json";
const PER_PAGE = 100;

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`GitHub answered ${status}: ${body.slice(0, 200)}`);
  }
}

// A save whose sha is no longer the file's: projects.json changed on main since the page loaded.
export class ConflictError extends Error {
  constructor() {
    super("content/projects.json changed on main since this page loaded.");
  }
}

// One GitHub REST call with the signed-in user's token. The token is only ever a request header: it is not in any error message.
export async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...init.headers },
  });
  if (!response.ok) throw new GitHubError(response.status, await response.text());
  return (response.status === 204 ? undefined : await response.json()) as T;
}

// GitHub's REST names for a repo, in the shape `gh repo list` prints and parseRepos checks. Anything unexpected is passed through
// as it is, so parseRepos rejects it by name. In particular a visibility it doesn't know is an error, never a guess.
function toGhShape(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const repo = raw as Record<string, unknown>;
  return {
    name: repo.name,
    visibility: typeof repo.visibility === "string" ? repo.visibility.toUpperCase() : repo.visibility,
    primaryLanguage: repo.language == null ? null : { name: repo.language },
    updatedAt: repo.updated_at,
    isFork: repo.fork,
    isArchived: repo.archived,
    url: repo.html_url,
    homepageUrl: repo.homepage ?? "",
  };
}

// The signed-in user's own repos, private ones included (the token has the repo scope), newest push first like `gh repo list`.
// A page shorter than PER_PAGE is the last one. shortcut: no page cap, GitHub's list is finite.
export async function listRepos(token: string): Promise<Repo[]> {
  const all: unknown[] = [];
  for (let page = 1; ; page++) {
    const batch = await gh<unknown>(token, `/user/repos?affiliation=owner&sort=pushed&per_page=${PER_PAGE}&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("GitHub must answer /user/repos with an array of repos");
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return parseRepos(all.map(toGhShape));
}

// content/projects.json on main, and the sha a later save has to send back: GitHub refuses a write whose sha is stale.
export async function readProjectsFile(token: string): Promise<{ projects: Project[]; sha: string }> {
  const file = await gh<{ content?: unknown; encoding?: unknown; sha?: unknown }>(token, `/repos/${OWNER}/${REPO}/contents/${PROJECTS_PATH}?ref=${BRANCH}`);
  if (file.encoding !== "base64" || typeof file.content !== "string" || typeof file.sha !== "string" || file.sha === "") {
    throw new Error(`GitHub's answer for ${PROJECTS_PATH} was not a base64 file with a sha.`);
  }
  return { projects: parseProjects(JSON.parse(Buffer.from(file.content, "base64").toString("utf8"))), sha: file.sha };
}

// One commit on main that replaces projects.json, and the file's new sha. The commit is authored by the token's user (no author is sent),
// and GitHub refuses it when `sha` is not the file's current one, which is what stops a stale page from overwriting a newer edit.
export async function commitProjects(token: string, projects: Project[], sha: string): Promise<string> {
  let saved: { content?: { sha?: unknown } } | null;
  try {
    saved = await gh(token, `/repos/${OWNER}/${REPO}/contents/${PROJECTS_PATH}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "content: update projects (admin)",
        content: Buffer.from(serializeProjects(projects), "utf8").toString("base64"),
        sha,
        branch: BRANCH,
      }),
    });
  } catch (error) {
    if (error instanceof GitHubError && error.status === 409) throw new ConflictError();
    throw error;
  }
  const next = saved?.content?.sha;
  if (typeof next !== "string" || next === "") throw new Error("GitHub committed the file but its answer had no new sha. Reload the page.");
  return next;
}
