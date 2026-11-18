import { listRepos, type Repo } from "@/lib/admin/github";
import { localOnly } from "@/lib/admin/origin";
import { publishedButNotPublic } from "@/lib/admin/publish";
import { commitProjects, ConflictError, listRepos as listRemoteRepos } from "@/lib/admin/remote";
import { isRemote, remoteGate } from "@/lib/admin/session";
import { writeProjects } from "@/lib/admin/writeProjects";
import { parseProjects, type Project } from "@/lib/projects";

const reply = (status: number, error: string) => Response.json({ error }, { status });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Only exactly PUBLIC counts as public.
const publicNames = (repos: Repo[]) => new Set(repos.filter((repo) => repo.visibility === "PUBLIC").map((repo) => repo.name));
const refusal = (blocked: string[]) =>
  `Not saved. Published projects need a public repo, and these have none (private, renamed or deleted): ${blocked.join(", ")}. Unpublish them first.`;

// The page sends the whole list and this replaces the whole file. The checks run in a fixed order, and nothing is written until all of them pass.
export const PUT = (request: Request) => (isRemote() ? putRemote(request) : putLocal(request));

async function putLocal(request: Request) {
  const forbidden = localOnly(request);
  if (forbidden) return forbidden;

  let projects: Project[];
  try {
    projects = parseProjects(await request.json());
  } catch (error) {
    return reply(400, messageOf(error));
  }

  try {
    // One gh call per save.
    const blocked = publishedButNotPublic(projects, publicNames(await listRepos()));
    if (blocked.length > 0) return reply(400, refusal(blocked));

    await writeProjects(projects);
    return Response.json(projects);
  } catch (error) {
    // gh missing or logged out, or the file could not be written.
    return reply(500, messageOf(error));
  }
}

// On the admin project the body is { projects, sha }: the list, and the sha of the file the page loaded it from.
async function parseSave(request: Request): Promise<{ projects: Project[]; sha: string }> {
  const body: unknown = await request.json();
  if (typeof body !== "object" || body === null) throw new Error("The body must be { projects, sha }.");
  const { projects, sha } = body as Record<string, unknown>; // a plain array (the local body) has no sha, so it fails below
  if (typeof sha !== "string" || sha === "") throw new Error("The body needs the sha of the file the page was loaded from: { projects, sha }.");
  return { projects: parseProjects(projects), sha };
}

// A save is one commit on main, made with the signed-in user's token. Gate, then body, then the publish guard, then the commit.
async function putRemote(request: Request) {
  const token = remoteGate(request, { write: true });
  if (token instanceof Response) return token;

  let save: { projects: Project[]; sha: string };
  try {
    save = await parseSave(request);
  } catch (error) {
    return reply(400, messageOf(error));
  }

  try {
    const blocked = publishedButNotPublic(save.projects, publicNames(await listRemoteRepos(token)));
    if (blocked.length > 0) return reply(400, refusal(blocked));

    const sha = await commitProjects(token, save.projects, save.sha);
    return Response.json({ projects: save.projects, sha });
  } catch (error) {
    if (error instanceof ConflictError) return reply(409, "projects.json changed elsewhere, reload the page.");
    return reply(500, messageOf(error));
  }
}
