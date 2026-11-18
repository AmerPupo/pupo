"use client";

import { useState, type ChangeEvent } from "react";
import { PRIMARY, SECONDARY } from "@/components/buttonStyles";
import type { DraftReply } from "@/lib/admin/claude";
import type { Repo } from "@/lib/admin/github";
import { HOME_LIMIT, moveProject, shownOnHome, upsertProject } from "@/lib/admin/order";
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

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

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

// Both admin routes answer with their JSON result, or { error } and a status. Anything else (a crash page, no connection) still gets a message.
async function send<T>(method: "PUT" | "POST", url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof error === "string" ? error : `The server answered ${response.status}.`);
  }
  return body as T;
}

// The server answers a save with the list it wrote.
const putProjects = (projects: Project[]) => send<Project[]>("PUT", "/api/admin/projects", projects);
const postDraft = (name: string, note: string) => send<DraftReply>("POST", "/api/admin/draft", { name, note });

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
  // Drafts from Claude, by repo name. They are what an editor starts from, and nothing is saved until Save. An entry stays here after its Save:
  // `rev` counts the generations, and the editor is keyed on it, so a new draft resets the form but a Save never remounts it (focus stays on the button).
  const [generated, setGenerated] = useState<Record<string, { project: Project; rev: number }>>({});
  const publicRepos = new Set(repos.filter((repo) => repo.visibility === "PUBLIC").map((repo) => repo.name));
  const onHome = new Set(shownOnHome(projects).map((project) => project.slug));
  // The saved projects, then drafts whose repo isn't in the file yet.
  const entries = [
    ...projects,
    ...Object.values(generated)
      .map((draft) => draft.project)
      .filter((draft) => !projects.some((project) => project.slug === draft.slug)),
  ];

  // Every change is "send the whole next list, then adopt what the server wrote". Each request replaces the whole file,
  // so callers must not start one while `busy`. Nothing changes here unless the server accepts it.
  async function commit(slug: string, next: Project[], done: string) {
    setBusy(true);
    setMessage({ slug, text: "Saving…", error: false });
    try {
      setProjects(await putProjects(next));
      setMessage({ slug, text: done, error: false });
    } catch (error) {
      setMessage({ slug, text: messageOf(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  // Generate and Regenerate take the same `busy` as a save, so nothing else can change the list while a run is going (it can take minutes).
  // The draft only fills an editor: nothing is written until Save.
  async function generate(slug: string, note: string) {
    if (busy) return;
    setBusy(true);
    setMessage({ slug, text: "Generating a draft with Claude. This can take a few minutes…", error: false });
    try {
      const draft = await postDraft(slug, note);
      // A demo URL that was typed in by hand survives a regenerate when the repo has no homepage to take one from.
      const demoUrl = draft.demoUrl ?? projects.find((project) => project.slug === slug)?.demoUrl;
      setGenerated((current) => ({
        ...current,
        [slug]: { project: { ...draft, slug, demoUrl, published: false }, rev: (current[slug]?.rev ?? 0) + 1 },
      }));
      setMessage({ slug, text: "Draft ready. It is not saved yet: edit it, then Save draft or Publish.", error: false });
    } catch (error) {
      setMessage({ slug, text: messageOf(error), error: true });
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
    await commit(updated.slug, upsertProject(projects, updated), done);
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
        <p className="mt-1 text-sm text-muted">
          The home page shows the first {HOME_LIMIT} published ones, in this order.
        </p>
        {entries.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No projects yet.</p>
        ) : (
          <ul className="mt-4">
            {entries.map((project) => {
              const gen = generated[project.slug];
              const isSaved = projects.some((saved) => saved.slug === project.slug);
              const isPublic = publicRepos.has(project.slug);
              return (
                <li key={project.slug} className="border-b border-border py-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <h3 className="font-medium wrap-anywhere">{project.name}</h3>
                    <span className="text-sm text-muted wrap-anywhere">{project.slug}</span>
                    <span className={`text-sm ${project.published ? "text-accent" : "text-muted"}`}>
                      {!isSaved ? "unsaved draft" : project.published ? "published" : "draft"}
                    </span>
                    {isSaved && project.published && !onHome.has(project.slug) && (
                      <span className={LABEL}>not on the home page</span>
                    )}
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
                  {/* `open` follows "has a draft from Claude", which a Save doesn't change, so a Save never closes the editor. */}
                  <details className="mt-3" open={gen ? true : undefined}>
                    <summary className="cursor-pointer text-sm">
                      Edit<span className="sr-only"> {project.name}</span>
                    </summary>
                    <ProjectEditor
                      key={`${project.slug}:${gen?.rev ?? 0}`}
                      project={project}
                      initial={gen?.project ?? project}
                      canPublish={isPublic}
                      busy={busy}
                      // Only the first draft of a repo that isn't saved yet: its item has just appeared, possibly far from the Generate button.
                      autoFocusName={!isSaved && gen?.rev === 1}
                      onSave={save}
                    />
                    {!project.published && isPublic && (
                      <RegenerateForm
                        name={project.name}
                        busy={busy}
                        onRegenerate={(note) => generate(project.slug, note)}
                      />
                    )}
                  </details>
                  {message?.slug === project.slug && <MessageLine message={message} />}
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
              <th scope="col" className="py-2 pr-6 font-medium">
                Status
              </th>
              <th scope="col" className="py-2 font-medium">
                Action
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
                  <td className={`py-3 pr-6 ${status === "published" ? "text-accent" : ""}`}>{status}</td>
                  <td className="py-3">
                    {/* Only public repos can be drafted (the server checks too). Once a draft exists, its item has Regenerate. */}
                    {status === "not added" && repo.visibility === "PUBLIC" && !generated[repo.name] && (
                      <button
                        type="button"
                        aria-label={`Generate a draft for ${repo.name}`}
                        aria-disabled={busy}
                        onClick={() => generate(repo.name, "")}
                        className={`${SECONDARY} ${DISABLED}`}
                      >
                        Generate
                      </button>
                    )}
                    {/* With no item yet (a run in progress, or one that failed) the message has nowhere else to show. */}
                    {message?.slug === repo.name && !entries.some((entry) => entry.slug === repo.name) && (
                      <MessageLine message={message} />
                    )}
                  </td>
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
// The fields start from `initial` (a draft from Claude, or the project itself) and are only read once, so a new draft needs a new `key`.
function ProjectEditor({
  project,
  initial,
  canPublish,
  busy,
  autoFocusName,
  onSave,
}: {
  project: Project;
  initial: Project;
  canPublish: boolean;
  busy: boolean;
  autoFocusName: boolean;
  onSave: (project: Project, done: string) => void;
}) {
  const [form, setForm] = useState(() => toForm(initial));
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
        <input type="text" autoFocus={autoFocusName} {...field("name")} className={FIELD} />
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

// Beside the editor, not inside it: every generation remounts the editor, and the note should survive to the next one.
// Its own form, so Enter in the note field regenerates instead of submitting the editor's Save.
function RegenerateForm({
  name,
  busy,
  onRegenerate,
}: {
  name: string;
  busy: boolean;
  onRegenerate: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <form
      aria-label={`Regenerate ${name}`}
      onSubmit={(event) => {
        event.preventDefault();
        onRegenerate(note);
      }}
      className="mt-6 flex flex-wrap items-end gap-3"
    >
      <label className="block min-w-60 flex-1 text-sm">
        Note for Claude <span className="text-muted">(optional, for example: focus on the backend)</span>
        <input type="text" value={note} onChange={(event) => setNote(event.target.value)} className={FIELD} />
      </label>
      <button type="submit" aria-disabled={busy} className={`${SECONDARY} ${DISABLED}`}>
        Regenerate
      </button>
    </form>
  );
}

function MessageLine({ message }: { message: Message }) {
  return (
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
  );
}
