import { generateDraft } from "@/lib/admin/claude";
import { parseDraftRequest, type DraftRequest } from "@/lib/admin/draftRequest";
import { cloneRepo, listRepos } from "@/lib/admin/github";
import { localOnly } from "@/lib/admin/origin";
import { isHttpUrl } from "@/lib/projects";

const reply = (status: number, error: string) => Response.json({ error }, { status });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// POST { name, note? } drafts the portfolio entry for one public repo. The checks run in a fixed order, and nothing is cloned until all of them pass.
// Nothing is saved here either: the admin page puts the draft in its editor, and Save (the PUT route) is what writes the file.
export async function POST(request: Request) {
  const forbidden = localOnly(request);
  if (forbidden) return forbidden;

  let input: DraftRequest;
  try {
    input = parseDraftRequest(await request.json());
  } catch (error) {
    return reply(400, messageOf(error));
  }

  try {
    // Only exactly PUBLIC passes, and the name has to match a listed repo exactly, as in the publish guard.
    const repo = (await listRepos()).find((candidate) => candidate.name === input.name);
    if (!repo) return reply(400, `No repository named "${input.name}" was found.`);
    if (repo.visibility !== "PUBLIC") {
      return reply(400, `"${repo.name}" is ${repo.visibility.toLowerCase()}. Only public repositories can be drafted.`);
    }

    const draft = await generateDraft(await cloneRepo(repo.name), input.note);
    // The homepage field is free text, and a value that isn't an http(s) URL would make Save fail, so it is left out.
    return Response.json({ ...draft, repoUrl: repo.url, demoUrl: isHttpUrl(repo.homepageUrl) ? repo.homepageUrl : undefined });
  } catch (error) {
    // gh missing or logged out, the clone failed, or claude failed or timed out. The message says which.
    return reply(500, messageOf(error));
  }
}
