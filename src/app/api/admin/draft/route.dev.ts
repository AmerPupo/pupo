import { randomUUID } from "node:crypto";
import { generateDraft, type Draft, type DraftReply } from "@/lib/admin/claude";
import { parseDraftRequest, type DraftRequest } from "@/lib/admin/draftRequest";
import { cloneRepo, listRepos, removeClone, type Repo } from "@/lib/admin/github";
import { localOnly } from "@/lib/admin/origin";
import { dispatchDraft, findDraft, GitHubError, listRepos as listRemoteRepos } from "@/lib/admin/remote";
import { isRemote, remoteGate } from "@/lib/admin/session";
import { isHttpUrl, isValidSlug } from "@/lib/projects";

const reply = (status: number, error: string) => Response.json({ error }, { status });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The same check the workflow makes of its request_id input.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The listed repo to draft, or the 400 that says why not. Only exactly PUBLIC passes, and the name has to match a listed repo exactly, as in the publish guard.
function draftable(repos: Repo[], name: string): Repo | Response {
  const repo = repos.find((candidate) => candidate.name === name);
  if (!repo) return reply(400, `No repository named "${name}" was found.`);
  if (repo.visibility !== "PUBLIC") return reply(400, `"${repo.name}" is ${repo.visibility.toLowerCase()}. Only public repositories can be drafted.`);
  return repo;
}

// The homepage field is free text, and a value that isn't an http(s) URL would make Save fail, so it is left out.
const withLinks = (draft: Draft, repo: Repo): DraftReply => ({ ...draft, repoUrl: repo.url, demoUrl: isHttpUrl(repo.homepageUrl) ? repo.homepageUrl : undefined });

// POST { name, note? } drafts the portfolio entry for one public repo. The checks run in a fixed order, and nothing is cloned or started until all of them pass.
// Nothing is saved here either: the admin page puts the draft in its editor, and Save (the PUT route) is what writes the file.
export const POST = (request: Request) => (isRemote() ? postRemote(request) : postLocal(request));

// GET ?id=&name= is the admin project asking how the run that POST started is going. The local admin answers its POST with the draft, so it has no run to ask about.
export const GET = (request: Request) => (isRemote() ? getRemote(request) : reply(404, "Not found."));

async function postLocal(request: Request) {
  const forbidden = localOnly(request);
  if (forbidden) return forbidden;

  let input: DraftRequest;
  try {
    input = parseDraftRequest(await request.json());
  } catch (error) {
    return reply(400, messageOf(error));
  }

  let cloned: string | undefined; // set once a clone is about to start, so only a folder this request made is deleted
  try {
    const repo = draftable(await listRepos(), input.name);
    if (repo instanceof Response) return repo;

    cloned = repo.name;
    const draft = await generateDraft(await cloneRepo(repo.name), input.note);
    return Response.json(withLinks(draft, repo));
  } catch (error) {
    // gh missing or logged out, the clone failed, or claude failed or timed out. The message says which.
    return reply(500, messageOf(error));
  } finally {
    // The clone is only needed for the run (a big repo is about 1 GB), so it goes whether the run worked or not.
    if (cloned) await removeClone(cloned);
  }
}

// Starts a GitHub Actions run, which clones the repo without a token and drafts it, and answers 202 with the id the page asks about.
async function postRemote(request: Request) {
  const token = remoteGate(request, { write: true });
  if (token instanceof Response) return token;

  let input: DraftRequest;
  try {
    input = parseDraftRequest(await request.json());
  } catch (error) {
    return reply(400, messageOf(error));
  }

  try {
    const repo = draftable(await listRemoteRepos(token), input.name);
    if (repo instanceof Response) return repo;

    const id = randomUUID();
    await dispatchDraft(token, repo.name, input.note, id);
    return Response.json({ id }, { status: 202 });
  } catch (error) {
    return reply(500, messageOf(error));
  }
}

// 202 while the run goes, 200 with the draft when it is done, 500 when it ended without a usable one. A GitHub outage is 502, which the page asks again about.
// `name` only picks the repo whose links go with the draft: the id alone says which run to read, and the draft is the user's own to edit before it is saved.
async function getRemote(request: Request) {
  const token = remoteGate(request, { write: false });
  if (token instanceof Response) return token;

  const query = new URL(request.url).searchParams;
  const id = query.get("id");
  const name = query.get("name");
  if (id === null || !UUID.test(id)) return reply(400, "id must be the UUID the POST answered with.");
  if (!isValidSlug(name)) return reply(400, "name must be a repository name.");

  try {
    const found = await findDraft(token, id);
    if (found.status === "pending") return Response.json(found, { status: 202 });
    // The run URL goes last and bare, so the page can turn it into a link.
    if (found.status === "failed") return reply(500, `${found.reason} ${found.runUrl}`);

    const repo = draftable(await listRemoteRepos(token), name);
    return repo instanceof Response ? repo : Response.json(withLinks(found.draft, repo));
  } catch (error) {
    return reply(error instanceof GitHubError && error.status >= 500 ? 502 : 500, messageOf(error));
  }
}
