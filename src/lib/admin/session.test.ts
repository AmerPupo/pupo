import { afterEach, describe, expect, it, vi } from "vitest";
import { isRemote, openSession, remoteGate, SESSION_COOKIE, sealSession, type Session } from "./session";

const SECRET = Buffer.alloc(32, 7).toString("base64");
const OTHER_SECRET = Buffer.alloc(32, 9).toString("base64");
const HOST = "pupo-admin.vercel.app";

const session = (over: Partial<Session> = {}): Session => ({
  login: "AmerPupo",
  token: "test-oauth-token-value",
  exp: Date.now() + 60_000,
  ...over,
});

// Seals under SECRET, whatever the environment held before.
function seal(over: Partial<Session> = {}, secret = SECRET): string {
  vi.stubEnv("SESSION_SECRET", secret);
  return sealSession(session(over));
}

// Flips one byte of the decoded cookie, so the change lands in a chosen part of iv ‖ tag ‖ ciphertext.
function flipByte(sealed: string, offset: number): string {
  const raw = Buffer.from(sealed, "base64url");
  raw[offset] ^= 0xff;
  return raw.toString("base64url");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("isRemote", () => {
  it("is true only when ADMIN is exactly 1, and is read on every call", () => {
    vi.stubEnv("ADMIN", "1");
    expect(isRemote()).toBe(true);
    vi.stubEnv("ADMIN", "0");
    expect(isRemote()).toBe(false);
    vi.stubEnv("ADMIN", "true");
    expect(isRemote()).toBe(false);
    vi.stubEnv("ADMIN", "");
    expect(isRemote()).toBe(false);
  });
});

describe("sealSession and openSession", () => {
  it("round-trips a session", () => {
    const original = session();

    expect(openSession(seal(original))).toEqual(original);
  });

  it("encrypts: neither the login nor the token is readable in the cookie", () => {
    const sealed = seal();
    const text = Buffer.from(sealed, "base64url").toString("latin1");

    expect(sealed).not.toContain("AmerPupo");
    expect(text).not.toContain("AmerPupo");
    expect(text).not.toContain("test-oauth-token-value");
  });

  it("uses a fresh IV, so sealing the same session twice gives two cookies", () => {
    const original = session();
    vi.stubEnv("SESSION_SECRET", SECRET);

    expect(sealSession(original)).not.toBe(sealSession(original));
  });

  // iv is bytes 0-11, the tag 12-27, the ciphertext from 28.
  it.each([
    ["the IV", 0],
    ["the tag", 12],
    ["the end of the tag", 27],
    ["the ciphertext", 28],
    ["the last byte", -1],
  ])("opens a cookie with a changed byte in %s as null", (_, offset) => {
    const sealed = seal();
    const at = offset < 0 ? Buffer.from(sealed, "base64url").length + offset : offset;

    expect(openSession(flipByte(sealed, at))).toBeNull();
  });

  it.each([0, 1, 11, 12, 20, 27, 28, 29])("opens a cookie truncated to %i bytes as null", (length) => {
    const raw = Buffer.from(seal(), "base64url");

    expect(openSession(raw.subarray(0, length).toString("base64url"))).toBeNull();
  });

  it("opens a cookie with bytes appended as null", () => {
    const raw = Buffer.from(seal(), "base64url");

    expect(openSession(Buffer.concat([raw, Buffer.from("x")]).toString("base64url"))).toBeNull();
  });

  it("opens an expired session as null, and one that expires in the future as itself", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    expect(openSession(seal({ exp: 999_999 }))).toBeNull();
    expect(openSession(seal({ exp: 1_000_000 }))).toBeNull();
    expect(openSession(seal({ exp: 1_000_001 }))?.exp).toBe(1_000_001);
  });

  it("opens a cookie sealed under another key as null", () => {
    const sealed = seal({}, OTHER_SECRET);
    vi.stubEnv("SESSION_SECRET", SECRET);

    expect(openSession(sealed)).toBeNull();
  });

  it.each([undefined, null, "", "garbage", "!!!!", "AAAA", "A".repeat(200), "{}", JSON.stringify(session())])(
    "opens %j as null",
    (value) => {
      vi.stubEnv("SESSION_SECRET", SECRET);

      expect(openSession(value)).toBeNull();
    },
  );

  // Right key and a good tag, but the payload is not a session.
  it.each<[string, unknown]>([
    ["a numeric login", { login: 1 }],
    ["a missing token", { token: undefined }],
    ["a numeric token", { token: 5 }],
    ["a string expiry", { exp: "soon" }],
    ["a null expiry", { exp: null }],
  ])("opens a sealed payload with %s as null", (_, over) => {
    expect(openSession(seal(over as Partial<Session>))).toBeNull();
  });

  it("keeps only the three session fields", () => {
    const opened = openSession(seal({ extra: "x" } as Partial<Session>));

    expect(Object.keys(opened!).sort()).toEqual(["exp", "login", "token"]);
  });

  describe("without a usable SESSION_SECRET", () => {
    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["16 bytes, base64", Buffer.alloc(16, 7).toString("base64")],
      ["31 bytes, base64", Buffer.alloc(31, 7).toString("base64")],
      ["33 bytes, base64", Buffer.alloc(33, 7).toString("base64")],
      ["32 characters that are not 32 bytes", "a".repeat(32)],
    ])("a %s secret opens the cookie as null and refuses to seal", (_, secret) => {
      const sealed = seal();
      vi.stubEnv("SESSION_SECRET", secret);

      expect(openSession(sealed)).toBeNull();
      expect(() => sealSession(session())).toThrow(/SESSION_SECRET/);
    });
  });
});

describe("remoteGate", () => {
  const request = (method: string, headers: Record<string, string>) =>
    new Request(`https://${HOST}/api/admin/x`, { method, headers });
  const cookie = (value: string) => `${SESSION_COOKIE}=${value}`;
  const WRITE = { write: true };

  async function expectDenied(result: ReturnType<typeof remoteGate>, status: number) {
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(status);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("error");
    expect(body).not.toContain("test-oauth-token-value");
  }

  it("returns the token for a write from this site with a valid session", () => {
    const headers = { host: HOST, origin: `https://${HOST}`, cookie: cookie(seal()) };

    expect(remoteGate(request("PUT", headers), WRITE)).toBe("test-oauth-token-value");
  });

  it("finds the session among other cookies", () => {
    const headers = { host: HOST, origin: `https://${HOST}`, cookie: `a=1; ${cookie(seal())}; b=2` };

    expect(remoteGate(request("PUT", headers), WRITE)).toBe("test-oauth-token-value");
  });

  it("does not need an Origin for a read", () => {
    const headers = { host: HOST, cookie: cookie(seal()) };

    expect(remoteGate(request("GET", headers), { write: false })).toBe("test-oauth-token-value");
  });

  // Each of these has a valid session, so only the Origin check can refuse them.
  it.each<[string, Record<string, string>]>([
    ["no Origin", { host: HOST }],
    ["a foreign Origin", { host: HOST, origin: "https://example.com" }],
    ["an http Origin", { host: HOST, origin: `http://${HOST}` }],
    ["a look-alike Origin", { host: HOST, origin: `https://${HOST}.evil.com` }],
    ["a prefix of the host", { host: HOST, origin: "https://pupo-admin.vercel.ap" }],
    ["an Origin with a path", { host: HOST, origin: `https://${HOST}/` }],
    ["the Origin null", { host: HOST, origin: "null" }],
    ["an Origin and no Host", { origin: "https://null" }],
    ["a foreign Host", { host: "evil.example", origin: `https://${HOST}` }],
  ])("answers 403 to a write with %s, even with a valid session", async (_, headers) => {
    const withCookie = { ...headers, cookie: cookie(seal()) };

    await expectDenied(remoteGate(request("PUT", withCookie), WRITE), 403);
  });

  it("checks the Origin before the cookie: a foreign write with no session is 403, not 401", async () => {
    await expectDenied(remoteGate(request("PUT", { host: HOST, origin: "https://example.com" }), WRITE), 403);
  });

  // Built inside the test, because seal() sets SESSION_SECRET and each test's stubs are undone afterwards.
  it.each<[string, () => string | undefined]>([
    ["no cookie", () => undefined],
    ["an empty cookie header", () => ""],
    ["other cookies only", () => "a=1; b=2"],
    ["an empty session cookie", () => cookie("")],
    ["a garbage session cookie", () => cookie("garbage")],
    ["a tampered session cookie", () => cookie(flipByte(seal(), 30))],
    ["an expired session cookie", () => cookie(seal({ exp: Date.now() - 1 }))],
    ["a cookie of another name", () => `evil-${cookie(seal())}`],
    ["the session under another name", () => `other=${seal()}`],
  ])("answers 401 for %s, for a write and for a read", async (_, makeHeader) => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const header = makeHeader();
    const headers: Record<string, string> = { host: HOST, origin: `https://${HOST}` };
    if (header !== undefined) headers.cookie = header;

    await expectDenied(remoteGate(request("PUT", headers), WRITE), 401);
    await expectDenied(remoteGate(request("GET", headers), { write: false }), 401);
  });

  it("answers 401 when SESSION_SECRET is missing, whatever the cookie holds", async () => {
    const headers = { host: HOST, origin: `https://${HOST}`, cookie: cookie(seal()) };
    vi.stubEnv("SESSION_SECRET", undefined);

    await expectDenied(remoteGate(request("PUT", headers), WRITE), 401);
  });
});
