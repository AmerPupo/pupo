import type { Repo } from "@/lib/admin/github";
import type { Project } from "@/lib/projects";

const LABEL = "ml-2 rounded border border-border px-1.5 py-0.5 text-xs font-normal text-muted";

// A repo is "added" once projects.json has an entry named after it, and a draft is an entry that isn't published yet.
function statusOf(repo: Repo, projects: Project[]) {
  const project = projects.find((p) => p.slug === repo.name);
  if (!project) return "not added";
  return project.published ? "published" : "draft";
}

// Nothing here is interactive yet, so this is a server component. Once it holds editing state it needs "use client",
// and from then on it may only `import type` from github.ts, which runs child processes.
export function AdminApp({ repos, projects }: { repos: Repo[]; projects: Project[] }) {
  return (
    <>
      <p className="mt-2 text-muted">{repos.length} repositories</p>
      <table className="mt-8 w-full text-left text-sm">
        <thead className="text-muted">
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-6 font-medium">
              Repository
            </th>
            <th scope="col" className="py-2 pr-6 font-medium">
              Visibility
            </th>
            <th scope="col" className="py-2 pr-6 font-medium">
              Language
            </th>
            <th scope="col" className="py-2 pr-6 font-medium">
              Updated
            </th>
            <th scope="col" className="py-2 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {repos.map((repo) => {
            const status = statusOf(repo, projects);
            return (
              <tr key={repo.name} className="border-b border-border">
                <th scope="row" className="py-3 pr-6 text-left font-medium wrap-anywhere">
                  <a href={repo.url} target="_blank" className="hover:underline">
                    {repo.name}
                  </a>
                  {repo.isFork && <span className={LABEL}>fork</span>}
                  {repo.isArchived && <span className={LABEL}>archived</span>}
                </th>
                <td className="py-3 pr-6">
                  {repo.visibility !== "PUBLIC" && (
                    <>
                      <span role="img" aria-label="locked">
                        🔒
                      </span>{" "}
                    </>
                  )}
                  <span className="capitalize">{repo.visibility.toLowerCase()}</span>
                </td>
                <td className="py-3 pr-6">{repo.primaryLanguage?.name ?? "none"}</td>
                <td className="py-3 pr-6">
                  <time dateTime={repo.updatedAt}>{repo.updatedAt.slice(0, 10)}</time>
                </td>
                <td className={`py-3 ${status === "published" ? "text-accent" : ""}`}>{status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
