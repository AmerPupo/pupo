import { parseProjects, serializeProjects, type Project } from "../projects";
import { isObject, toDraft, type Draft } from "./claude";
import { OWNER, parseRepos, type Repo } from "./github";

const API = "https://api.github.com";
const REPO = "pupo";
const BRANCH = "main";
const PROJECTS_PATH = "content/projects.json";
const WORKFLOW = "draft.yml";
const PER_PAGE = 100;
const RUNS_PER_PAGE = 30;

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

// Starts the draft workflow on main for one repo. The workflow checks these inputs again, and an empty note is left out so its default ("") applies.
// GitHub answers 204 with no run id, so findDraft finds the run by its run-name.
export async function dispatchDraft(token: string, name: string, note: string | undefined, id: string): Promise<void> {
  await gh(token, `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: BRANCH, inputs: { repo: name, request_id: id, ...(note ? { note } : {}) } }),
  });
}

// pending: no run yet (no URL) or the run is still going. done: the run's draft. failed: the run ended without a usable draft, with why.
export type DraftStatus =
  | { status: "pending"; runUrl?: string }
  | { status: "done"; draft: Draft }
  | { status: "failed"; runUrl: string; reason: string };

// The entries of the list GitHub puts under `key` (workflow_runs, artifacts).
function listOf(body: unknown, key: string): Record<string, unknown>[] {
  const items = isObject(body) ? body[key] : undefined;
  if (!Array.isArray(items)) throw new Error(`GitHub's answer had no ${key} list.`);
  return items.filter(isObject);
}

// Where the draft run for request `id` stands. A GitHub error is thrown, not reported as failed, so the caller can poll again.
// shortcut: the run is looked for among the newest RUNS_PER_PAGE dispatches, which is plenty for one admin who waits for each run.
export async function findDraft(token: string, id: string): Promise<DraftStatus> {
  const runs = listOf(await gh(token, `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=${RUNS_PER_PAGE}`), "workflow_runs");
  // The run-name is `draft <repo> <request_id>` and the id is a UUID, so the one run that ends with it is ours.
  const run = runs.find((r) => typeof r.display_title === "string" && r.display_title.endsWith(` ${id}`));
  if (!run) return { status: "pending" };

  const { id: runId, html_url: runUrl, status, conclusion } = run;
  if (typeof runId !== "number" || typeof runUrl !== "string" || typeof status !== "string") {
    throw new Error("GitHub's answer for the draft run had no id, html_url or status.");
  }
  if (status !== "completed") return { status: "pending", runUrl };

  // The workflow uploads with archive: false, so the artifact is the plain file draft-<id>.json and the download needs no unzip.
  const artifacts = listOf(await gh(token, `/repos/${OWNER}/${REPO}/actions/runs/${runId}/artifacts`), "artifacts");
  const artifact = artifacts.find((a) => a.name === `draft-${id}.json` && a.expired !== true);
  if (typeof artifact?.id !== "number") return { status: "failed", runUrl, reason: `The run finished (${conclusion ?? "no conclusion"}) without a draft.` };

  const file = await gh<unknown>(token, `/repos/${OWNER}/${REPO}/actions/artifacts/${artifact.id}/zip`);
  try {
    return { status: "done", draft: toDraft(file) };
  } catch (error) {
    return { status: "failed", runUrl, reason: (error as Error).message };
  }
}
