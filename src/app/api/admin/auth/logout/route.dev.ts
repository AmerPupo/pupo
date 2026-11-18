import { cookieHeader, isRemote, SESSION_COOKIE, thisSiteOnly } from "@/lib/admin/session";

// Drops the cookie. It does not revoke the OAuth token at GitHub (the README says how). A session isn't needed, so an expired one can still sign out.
export function POST(request: Request) {
  if (!isRemote()) return new Response(null, { status: 404 });

  const forbidden = thisSiteOnly(request);
  if (forbidden) return forbidden;

  // 303, so the browser follows a form POST with a GET.
  return new Response(null, {
    status: 303,
    headers: { Location: new URL("/admin", request.url).toString(), "Set-Cookie": cookieHeader(SESSION_COOKIE, "", 0) },
  });
}
