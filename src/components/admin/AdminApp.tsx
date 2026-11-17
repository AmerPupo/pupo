"use client";

import { useState, type ChangeEvent } from "react";
import { PRIMARY, SECONDARY } from "@/components/buttonStyles";
import type { Repo } from "@/lib/admin/github";
import { moveProject } from "@/lib/admin/order";
import type { Project } from "@/lib/projects";

// This runs in the browser, so it may only `import type` from github.ts (child processes) and projects.ts (node:fs).
// Anything it imports as a value, like order.ts, has to stay free of Node modules.

const LABEL = "ml-2 rounded border border-border px-1.5 py-0.5 text-xs font-normal text-muted";
const FIELD = "mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm";
// aria-disabled, not disabled, for a request in flight and for an arrow with nowhere to go: a button that becomes disabled
// drops keyboard focus. The handlers ignore the click, so it does nothing.
const DISABLED = "disabled:pointer-events-none disabled:opacity-40 aria-disabled:opacity-40";

// The editable fields of a Project, as the text the inputs hold.
type Form = { name: string; tagline: string; description: string; tech: string; demoUrl: string };
type Message = { slug: string; text: string; error: boolean };

const toForm = (project: Project): Form => ({
  name: project.name,
  tagline: project.tagline,
  description: project.description,
  tech: project.tech.join(", "),
  demoUrl: project.demoUrl ?? "",
});

function toProject(base: Project, form: Form, published: boolean): Project {
  return {
    ...base,
    name: form.name.trim(),
    tagline: form.tagline.trim(),
    description: form.description.trim(),
    tech: form.tech.split(",").map((tag) => tag.trim()).filter(Boolean),
    demoUrl: form.demoUrl.trim() || undefined, // the schema wants the key absent when there is no demo, never ""
    published,
  };
}

// The server answers with the list it wrote, or { error } and a status. Anything else (a crash page, no connection) still gets a message.
async function putProjects(projects: Project[]): Promise<Project[]> {
  const response = await fetch("/api/admin/projects", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(projects),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof error === "string" ? error : `The server answered ${response.status}.`);
  }
  return body as Project[];
}

// A repo is "added" once projects.json has an entry named after it, and a draft is an entry that isn't published yet.
function statusOf(repo: Repo, projects: Project[]) {
  const project = projects.find((p) => p.slug === repo.name);
  if (!project) return "not added";
  return project.published ? "published" : "draft";
}

export function AdminApp({ repos, projects: initialProjects }: { repos: Repo[]; projects: Project[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const publicRepos = new Set(repos.filter((repo) => repo.visibility === "PUBLIC").map((repo) => repo.name));

  // Every change is "send the whole next list, then adopt what the server wrote". Each request replaces the whole file,
  // so callers must not start one while `busy`. Nothing changes here unless the server accepts it.
  async function commit(slug: string, next: Project[], done: string) {
    setBusy(true);
    setMessage({ slug, text: "Saving…", error: false });
    try {
      setProjects(await putProjects(next));
      setMessage({ slug, text: done, error: false });
    } catch (error) {
      setMessage({ slug, text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function save(updated: Project, done: string) {
    if (busy) return;
    const wasPublished = projects.find((p) => p.slug === updated.slug)?.published;
    const othersPublished = projects.some((p) => p.published && p.slug !== updated.slug);
    // With nothing published, generateStaticParams returns [] and the production build fails, so the old site would stay up.
    if (wasPublished && !updated.published && !othersPublished) {
      const ok = window.confirm(
        "This is the only published project. With none published, the production build fails until one is published again. Unpublish it anyway?",
      );
      if (!ok) return;
    }
    await commit(updated.slug, projects.map((p) => (p.slug === updated.slug ? updated : p)), done);
  }

  async function move(slug: string, step: -1 | 1) {
    const next = busy ? null : moveProject(projects, slug, step);
    if (next) await commit(slug, next, step < 0 ? "Moved up." : "Moved down.");
  }

  return (
    <>
      <section aria-labelledby="projects-title" className="mt-8">
        <h2 id="projects-title" className="text-lg font-semibold">
          Projects
        </h2>
        <p className="mt-1 text-sm text-muted">The carousel shows the published ones, in this order.</p>
        {projects.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No projects yet.</p>
        ) : (
          <ul className="mt-4">
            {projects.map((project) => {
              const isPublic = publicRepos.has(project.slug);
              return (
                <li key={project.slug} className="border-b border-border py-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <h3 className="font-medium wrap-anywhere">{project.name}</h3>
                    <span className="text-sm text-muted wrap-anywhere">{project.slug}</span>
                    <span className={`text-sm ${project.published ? "text-accent" : "text-muted"}`}>
                      {project.published ? "published" : "draft"}
                    </span>
                    {!isPublic && <span className={LABEL}>repo private or missing</span>}
                    {project.published && (
                      <div className="ml-auto flex gap-2">
                        <button
                          type="button"
                          aria-label={`Move ${project.name} up`}
                          aria-disabled={busy || !moveProject(projects, project.slug, -1)}
                          onClick={() => move(project.slug, -1)}
                          className={`${SECONDARY} min-w-11 justify-center ${DISABLED}`}
                        >
                          <span aria-hidden="true">↑</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${project.name} down`}
                          aria-disabled={busy || !moveProject(projects, project.slug, 1)}
                          onClick={() => move(project.slug, 1)}
                          className={`${SECONDARY} min-w-11 justify-center ${DISABLED}`}
                        >
                          <span aria-hidden="true">↓</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm">
                      Edit<span className="sr-only"> {project.name}</span>
                    </summary>
                    <ProjectEditor project={project} canPublish={isPublic} busy={busy} onSave={save} />
                  </details>
                  {message?.slug === project.slug && (
                    <p
                      role={message.error ? "alert" : "status"}
                      className={
                        message.error
                          ? "mt-3 rounded-md border border-border bg-card p-3 text-sm whitespace-pre-wrap wrap-anywhere"
                          : "mt-3 text-sm text-muted"
                      }
                    >
                      {message.text}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="repos-title" className="mt-12">
        <h2 id="repos-title" className="text-lg font-semibold">
          Repositories
        </h2>
        <p className="mt-1 text-sm text-muted">{repos.length} repositories</p>
        <table className="mt-4 w-full text-left text-sm">
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
      </section>
    </>
  );
}

// Save, Publish and Unpublish all send what the fields hold now. Save keeps the published state, and the other two flip it.
function ProjectEditor({
  project,
  canPublish,
  busy,
  onSave,
}: {
  project: Project;
  canPublish: boolean;
  busy: boolean;
  onSave: (project: Project, done: string) => void;
}) {
  const [form, setForm] = useState(() => toForm(project));
  const field = (key: keyof Form) => ({
    value: form[key],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { value } = event.target;
      setForm((current) => ({ ...current, [key]: value }));
    },
  });

  return (
    <form
      aria-label={`Edit ${project.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(toProject(project, form, project.published), "Saved.");
      }}
      className="mt-3 grid gap-4"
    >
      <label className="block text-sm">
        Name
        <input type="text" {...field("name")} className={FIELD} />
      </label>
      <label className="block text-sm">
        Tagline <span className="text-muted">(one line)</span>
        <input type="text" {...field("tagline")} className={FIELD} />
      </label>
      <label className="block text-sm">
        Description <span className="text-muted">(a blank line between paragraphs)</span>
        <textarea rows={10} {...field("description")} className={FIELD} />
      </label>
      <label className="block text-sm">
        Tech <span className="text-muted">(comma-separated)</span>
        <input type="text" {...field("tech")} className={FIELD} />
      </label>
      <label className="block text-sm">
        Demo URL <span className="text-muted">(optional)</span>
        <input type="url" {...field("demoUrl")} className={FIELD} />
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="submit" aria-disabled={busy} className={`${PRIMARY} ${DISABLED}`}>
          {project.published ? "Save" : "Save draft"}
        </button>
        <button
          type="button"
          disabled={!project.published && !canPublish}
          aria-disabled={busy}
          title={!project.published && !canPublish ? "Only public repos can be published" : undefined}
          onClick={() =>
            onSave(
              toProject(project, form, !project.published),
              project.published ? "Unpublished." : "Published.",
            )
          }
          className={`${SECONDARY} ${DISABLED}`}
        >
          {project.published ? "Unpublish" : "Publish"}
        </button>
      </div>
    </form>
  );
}
