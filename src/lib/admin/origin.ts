// The dev server binds 127.0.0.1, so the only legitimate caller of an admin route is a page served from this machine.
// Browsers always send Origin on a PUT or POST. Match the whole string: a prefix test would accept http://localhost.evil.com.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/;

export function isLocalOrigin(origin: string | null): boolean {
  return origin !== null && LOCAL_ORIGIN.test(origin);
}
