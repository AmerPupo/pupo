import { timingSafeEqual } from "node:crypto";
import { OWNER } from "@/lib/admin/github";
import { gh } from "@/lib/admin/remote";
import { cookieHeader, isRemote, readCookie, sealSession, SESSION_COOKIE, SESSION_MS, STATE_COOKIE } from "@/lib/admin/session";

const reply = (status: number, error: string) => Response.json({ error }, { status });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Trades the one-time code for the user's token. GitHub reports a bad code as a 200 with an `error` field, so the status alone isn't enough.
async function exchangeCode(code: string, clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: unknown; error?: string; error_description?: string };
  if (!response.ok || typeof body.access_token !== "string" || body.access_token === "") {
    throw new Error(body.error_description ?? body.error ?? `GitHub answered ${response.status}`);
  }
  return body.access_token;
}

async function signIn(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const expected = readCookie(request.headers.get("cookie"), STATE_COOKIE);
  if (!state || !expected || !sameState(state, expected)) return reply(400, "The sign-in did not start here, or it timed out. Start again from /admin.");

  const code = params.get("code");
  if (!code) return reply(400, "GitHub sent no authorization code. Start again from /admin.");

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return reply(500, "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set on this project.");

  let token: string;
  let login: unknown;
  try {
    token = await exchangeCode(code, clientId, clientSecret);
    ({ login } = await gh<{ login?: unknown }>(token, "/user"));
  } catch (error) {
    return reply(502, `GitHub sign-in failed: ${messageOf(error)}`);
  }
  // The login comes from GitHub's answer for this token, never from the request. Logins are unique, so an exact match is the right test.
  if (login !== OWNER) return reply(403, `This admin is for ${OWNER} only.`);

  let sealed: string;
  try {
    sealed = sealSession({ login, token, exp: Date.now() + SESSION_MS });
  } catch (error) {
    return reply(500, messageOf(error)); // SESSION_SECRET missing or the wrong size
  }
  const headers = new Headers({ Location: new URL("/admin", request.url).toString() });
  headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, sealed, SESSION_MS / 1000));
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request) {
  if (!isRemote()) return new Response(null, { status: 404 });
  const response = await signIn(request);
  // The state is single-use, whatever the outcome.
  response.headers.append("Set-Cookie", cookieHeader(STATE_COOKIE, "", 0));
  return response;
}
