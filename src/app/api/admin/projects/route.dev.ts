import { listRepos } from "@/lib/admin/github";
import { localOnly } from "@/lib/admin/origin";
import { publishedButNotPublic } from "@/lib/admin/publish";
import { writeProjects } from "@/lib/admin/writeProjects";
import { parseProjects, type Project } from "@/lib/projects";

const reply = (status: number, error: string) => Response.json({ error }, { status });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The page sends the whole list and this replaces the whole file. The checks run in a fixed order, and nothing is written until all of them pass.
export async function PUT(request: Request) {
  const forbidden = localOnly(request);
  if (forbidden) return forbidden;

  let projects: Project[];
  try {
    projects = parseProjects(await request.json());
  } catch (error) {
    return reply(400, messageOf(error));
  }

  try {
    // One gh call per save. Only exactly PUBLIC counts as public.
    const publicRepos = new Set((await listRepos()).filter((repo) => repo.visibility === "PUBLIC").map((repo) => repo.name));
    const blocked = publishedButNotPublic(projects, publicRepos);
    if (blocked.length > 0) {
      return reply(
        400,
        `Not saved. Published projects need a public repo, and these have none (private, renamed or deleted): ${blocked.join(", ")}. Unpublish them first.`,
      );
    }

    await writeProjects(projects);
    return Response.json(projects);
  } catch (error) {
    // gh missing or logged out, or the file could not be written.
    return reply(500, messageOf(error));
  }
}
