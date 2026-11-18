import type { DraftReply } from "@/lib/admin/claude";
import type { Project } from "@/lib/projects";

// The admin page's requests to its own server. This runs in the browser, so it may only `import type` (the same rule as AdminApp.tsx).

type Answer = { ok: boolean; status: number; body: unknown };

async function call(method: "GET" | "PUT" | "POST", url: string, payload?: unknown): Promise<Answer> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
}

// Both admin routes answer with their JSON result, or { error } and a status. Anything else (a crash page, no connection) still gets a message.
const failure = ({ status, body }: Answer) => {
  const error = (body as { error?: unknown } | null)?.error;
  return new Error(typeof error === "string" ? error : `The server answered ${status}.`);
};

async function send<T>(method: "PUT" | "POST", url: string, payload: unknown): Promise<T> {
  const answer = await call(method, url, payload);
  if (!answer.ok) throw failure(answer);
  return answer.body as T;
}

// Local mode sends the plain array and gets the list it wrote. On the admin project the page holds the sha of the file it loaded, so the body is
// { projects, sha } and the answer carries the sha for the next save: GitHub refuses a save made from a stale one.
export async function putProjects(projects: Project[], sha: string | undefined): Promise<{ projects: Project[]; sha: string | undefined }> {
  if (sha === undefined) return { projects: await send<Project[]>("PUT", "/api/admin/projects", projects), sha };
  return send<{ projects: Project[]; sha: string }>("PUT", "/api/admin/projects", { projects, sha });
}
const POLL_MS = 10_000;
const GIVE_UP_POLLS = 90; // 15 minutes of POLL_MS

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The local server answers the POST with the draft. The admin project answers 202 { id }, because the draft is made by a GitHub Actions run,
// and the page asks about that run every POLL_MS until the draft comes, `onPending` hearing about each wait (with the run's URL once it has one).
// Counting asks, not minutes, means a phone that sleeps the tab only pauses the wait. A 502 (GitHub having a bad moment) and a lost connection are
// asked again, since the run goes on without us. So is any 5xx above 500: the route answers 500 for a failed run (which stops here) and 502 for GitHub,
// so a 503 or 504 comes from the host (Vercel ends a function that runs too long with a 504).
export async function requestDraft(name: string, note: string, onPending: (runUrl?: string) => void, wait = delay): Promise<DraftReply> {
  const started = await call("POST", "/api/admin/draft", { name, note });
  if (!started.ok) throw failure(started);
  if (started.status !== 202) return started.body as DraftReply;

  const { id } = started.body as { id?: unknown };
  if (typeof id !== "string") throw new Error("The server did not say which run to wait for.");
  const query = new URLSearchParams({ id, name });
  let runUrl: string | undefined;
  onPending(runUrl);
  for (let asks = 0; asks < GIVE_UP_POLLS; asks++) {
    await wait(POLL_MS);
    const answer = await call("GET", `/api/admin/draft?${query}`).catch(() => null);
    if (answer === null || answer.status >= 502) continue;
    if (answer.status === 202) {
      runUrl = (answer.body as { runUrl?: string }).runUrl;
      onPending(runUrl);
      continue;
    }
    if (!answer.ok) throw failure(answer);
    return answer.body as DraftReply;
  }
  throw new Error(`No draft after ${(GIVE_UP_POLLS * POLL_MS) / 60_000} minutes.${runUrl ? ` Check the run: ${runUrl}` : ""}`);
}
