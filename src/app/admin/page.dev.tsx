import { AdminApp } from "@/components/admin/AdminApp";
import { listRepos, type Repo } from "@/lib/admin/github";
import { readProjects, type Project } from "@/lib/projects";

export default async function AdminPage() {
  let data: { repos: Repo[]; projects: Project[] } | undefined;
  let error = "";
  try {
    const [repos, projects] = await Promise.all([listRepos(), readProjects()]);
    data = { repos, projects };
  } catch (e) {
    // gh missing or logged out, or a malformed projects.json: show the message instead of crashing the page.
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto w-full max-w-page px-6 py-12">
      <h1 className="text-2xl font-semibold">Admin (dev only)</h1>
      {data ? (
        <AdminApp {...data} />
      ) : (
        <div role="alert" className="mt-6 rounded-md border border-border bg-card p-4 text-sm">
          <p className="font-medium">Could not load the repositories or content/projects.json.</p>
          <p className="mt-2 whitespace-pre-wrap text-muted wrap-anywhere">{error}</p>
        </div>
      )}
    </main>
  );
}
