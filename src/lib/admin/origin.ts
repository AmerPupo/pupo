// The dev server binds 127.0.0.1, so the only legitimate caller of an admin route is a page served from this machine.
// Browsers always send Origin on a PUT or POST. Match the whole string: a prefix test would accept http://localhost.evil.com.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/;
// A page that rebinds its own DNS name to 127.0.0.1 is served under that name, so its Host is foreign. Same whole-string match.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1):\d{1,5}$/;

export function isLocalOrigin(origin: string | null): boolean {
  return origin !== null && LOCAL_ORIGIN.test(origin);
}

export function isLocalHost(host: string | null): boolean {
  return host !== null && LOCAL_HOST.test(host);
}

// The gate in front of every admin route: the 403 to return, or null when both Origin and Host are local.
export function localOnly(request: Request): Response | null {
  if (isLocalOrigin(request.headers.get("origin")) && isLocalHost(request.headers.get("host"))) return null;
  return Response.json({ error: "Admin requests must come from a page on http://localhost or http://127.0.0.1." }, { status: 403 });
}
