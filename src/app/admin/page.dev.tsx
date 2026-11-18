import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AdminApp } from "@/components/admin/AdminApp";
import { PRIMARY, SECONDARY } from "@/components/buttonStyles";
import { listRepos, type Repo } from "@/lib/admin/github";
import { isLocalHost } from "@/lib/admin/origin";
import { GitHubError, listRepos as listRemoteRepos, readProjectsFile } from "@/lib/admin/remote";
import { isRemote, openSession, readCookie, SESSION_COOKIE } from "@/lib/admin/session";
import { readProjects, type Project } from "@/lib/projects";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function LoadError({ error }: { error: string }) {
  return (
    <div role="alert" className="mt-6 rounded-md border border-border bg-card p-4 text-sm">
      <p className="font-medium">Could not load the repositories or content/projects.json.</p>
      <p className="mt-2 whitespace-pre-wrap text-muted wrap-anywhere">{error}</p>
    </div>
  );
}

const SignIn = (
  <a href="/api/admin/auth/login" className={PRIMARY}>
    Sign in with GitHub
  </a>
);

// The admin project (ADMIN=1): everything comes from GitHub with the signed-in user's token, and nothing from this machine.
// Without a session the page holds only the sign-in link and asks GitHub for nothing. Every await is here, not in a child component.
async function remotePage(cookie: string | null) {
  const session = openSession(readCookie(cookie, SESSION_COOKIE));
  if (!session) {
    return (
      <main className="mx-auto w-full max-w-page px-6 py-12">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="mt-4 text-muted">Sign in with the GitHub account that owns the repositories.</p>
        <div className="mt-6">{SignIn}</div>
      </main>
    );
  }

  let data: { repos: Repo[]; projects: Project[]; sha: string } | undefined;
  let error = "";
  let revoked = false;
  try {
    const [repos, file] = await Promise.all([listRemoteRepos(session.token), readProjectsFile(session.token)]);
    data = { repos, projects: file.projects, sha: file.sha };
  } catch (e) {
    error = messageOf(e);
    // GitHub answers 401 for a token that was revoked or has expired, and only a new sign-in fixes that.
    revoked = e instanceof GitHubError && e.status === 401;
  }

  return (
    <main className="mx-auto w-full max-w-page px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Admin</h1>
        {/* A plain form POST: no script needed, and the browser sends the Origin header the route checks. */}
        <form method="post" action="/api/admin/auth/logout">
          <button type="submit" className={SECONDARY}>
            Sign out
          </button>
        </form>
      </div>
      {data ? (
        <AdminApp {...data} />
      ) : (
        <>
          <LoadError error={error} />
          {revoked && <div className="mt-6">{SignIn}</div>}
        </>
      )}
    </main>
  );
}

export default async function AdminPage() {
  const requestHeaders = await headers();
  if (isRemote()) return remotePage(requestHeaders.get("cookie"));

  // A page that rebinds its own DNS name to 127.0.0.1 is served under that name, and could read this one (private repo names included).
  // The routes check Origin and Host for the writes. A GET has no Origin to check, so the page checks Host.
  if (!isLocalHost(requestHeaders.get("host"))) notFound();

  let data: { repos: Repo[]; projects: Project[] } | undefined;
  let error = "";
  try {
    const [repos, projects] = await Promise.all([listRepos(), readProjects()]);
    data = { repos, projects };
  } catch (e) {
    // gh missing or logged out, or a malformed projects.json: show the message instead of crashing the page.
    error = messageOf(e);
  }

  return (
    <main className="mx-auto w-full max-w-page px-6 py-12">
      <h1 className="text-2xl font-semibold">Admin (dev only)</h1>
      {data ? <AdminApp {...data} /> : <LoadError error={error} />}
    </main>
  );
}
