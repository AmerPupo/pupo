import { randomBytes } from "node:crypto";
import { cookieHeader, isRemote, STATE_COOKIE, STATE_SECONDS } from "@/lib/admin/session";

// Sends the browser to GitHub. The random state goes in a cookie as well, and the callback refuses a visit that can't show it again:
// that is what stops someone else's sign-in from being finished in this browser.
export function GET() {
  if (!isRemote()) return new Response(null, { status: 404 });

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return Response.json({ error: "GITHUB_CLIENT_ID must be set on this project." }, { status: 500 });

  const state = randomBytes(16).toString("base64url");
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.search = new URLSearchParams({ client_id: clientId, scope: "repo", state }).toString();
  return new Response(null, {
    status: 302,
    headers: { Location: authorize.toString(), "Set-Cookie": cookieHeader(STATE_COOKIE, state, STATE_SECONDS) },
  });
}
