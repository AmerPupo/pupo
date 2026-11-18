import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { reply } from "./http";

export type Session = { login: string; token: string; exp: number };

// The __Host- prefix makes browsers accept the cookie only with Secure, Path=/ and no Domain.
export const SESSION_COOKIE = "__Host-pupo-admin";
export const SESSION_MS = 8 * 60 * 60 * 1000;
// Sign-in sets this on the way to GitHub, and the callback must see the same value again.
export const STATE_COOKIE = "__Host-pupo-oauth-state";
export const STATE_SECONDS = 10 * 60;

const IV_BYTES = 12;
const TAG_BYTES = 16;

// Read per call, so a test can change it. ADMIN=1 is the second Vercel project: the admin online, behind GitHub sign-in.
export const isRemote = () => process.env.ADMIN === "1";

// 32 random bytes, base64. Anything else gives no key, and there is no default one.
function key(): Buffer | null {
  const bytes = Buffer.from(process.env.SESSION_SECRET ?? "", "base64");
  return bytes.length === 32 ? bytes : null;
}

// base64url of iv ‖ tag ‖ ciphertext, where the ciphertext is the session as JSON.
export function sealSession(session: Session): string {
  const secret = key();
  if (!secret) throw new Error("SESSION_SECRET must be 32 random bytes, base64 (openssl rand -base64 32).");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

// Null for anything that isn't a current session sealed under this key. Never throws.
export function openSession(sealed: string | null | undefined): Session | null {
  const secret = key();
  if (!secret || !sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", secret, raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const text = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
    const { login, token, exp } = JSON.parse(text) as Partial<Session>;
    if (typeof login !== "string" || typeof token !== "string" || typeof exp !== "number" || !(exp > Date.now())) return null;
    return { login, token, exp };
  } catch {
    return null;
  }
}

export function readCookie(header: string | null, name: string): string | undefined {
  const prefix = `${name}=`;
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
}

// A Set-Cookie value that only this host can read or set, and no script can read. Max-Age=0 clears it.
export const cookieHeader = (name: string, value: string, maxAgeSeconds: number) =>
  `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;

// The 403 to return unless a browser sent this write from a page on this site, or null. No session is needed, so sign-out can use it alone.
export function thisSiteOnly(request: Request): Response | null {
  const host = request.headers.get("host");
  if (host !== null && request.headers.get("origin") === `https://${host}`) return null;
  return reply(403, "Admin writes must come from a page on this site.");
}

// The gate in front of every remote admin route: the error to return, or the user's GitHub token.
// A write must come from a page on this site, and that is checked before the cookie is read.
export function remoteGate(request: Request, { write }: { write: boolean }): Response | string {
  if (write) {
    const forbidden = thisSiteOnly(request);
    if (forbidden) return forbidden;
  }
  const session = openSession(readCookie(request.headers.get("cookie"), SESSION_COOKIE));
  return session ? session.token : reply(401, "Sign in with GitHub first.");
}
