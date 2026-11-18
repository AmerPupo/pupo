import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSession, SESSION_COOKIE, STATE_COOKIE } from "@/lib/admin/session";
import { GET as login } from "../login/route.dev";
import { POST as logout } from "../logout/route.dev";
import { GET as callback } from "./route.dev";

// These three routes decide who gets a session, so GitHub is a stub: fetch is replaced, and no test can reach github.com or send a real token.
const HOST = "pupo-admin.vercel.app";
const SITE = `https://${HOST}`;
const SECRET = Buffer.alloc(32, 7).toString("base64");
const TOKEN = "test-oauth-token-value";
const EXCHANGE_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

type Step = { status?: number; body: unknown } | Error;

// Answers the two GitHub calls the callback makes. A call with no step fails the test, so "no GitHub call" can be asserted.
function stubGitHub(steps: { exchange?: Step; user?: Step } = {}) {
  const exchange = steps.exchange ?? { body: { access_token: TOKEN, token_type: "bearer", scope: "repo" } };
  const user = steps.user ?? { body: { login: "AmerPupo" } };
  const mock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const step = url === EXCHANGE_URL ? exchange : url === USER_URL ? user : new Error(`unexpected fetch ${url}`);
    if (step instanceof Error) throw step;
    return Response.json(step.body, { status: step.status ?? 200 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const callbackRequest = (query: string, cookie?: string) =>
  new Request(`${SITE}/api/admin/auth/callback?${query}`, { headers: cookie === undefined ? {} : { cookie } });

const stateCookie = (value: string) => `${STATE_COOKIE}=${value}`;
const setCookies = (response: Response) => response.headers.getSetCookie();
const sessionCookieSet = (response: Response) => setCookies(response).find((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`));

// Every cookie these routes set is for this host only (the __Host- prefix needs Secure, Path=/ and no Domain).
function expectFlags(cookie: string, name: string, maxAge: number) {
  expect(cookie.startsWith(`${name}=`)).toBe(true);
  expect(cookie).toMatch(new RegExp(`; Max-Age=${maxAge};`));
  for (const flag of ["; Path=/", "; HttpOnly", "; Secure", "; SameSite=Lax"]) expect(cookie).toContain(flag);
  expect(cookie).not.toMatch(/domain/i);
}

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  vi.stubEnv("ADMIN", "1");
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("GITHUB_CLIENT_ID", "test-client-id");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "test-client-secret");
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const nothingLogged = () => consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

describe("login", () => {
  it("answers 404 in local mode and sets nothing", () => {
    vi.stubEnv("ADMIN", undefined);
    const response = login();

    expect(response.status).toBe(404);
    expect(setCookies(response)).toEqual([]);
  });

  it("redirects to GitHub's authorize page with the repo scope and a state it keeps in a 10-minute cookie", () => {
    const response = login();
    const location = new URL(response.headers.get("location")!);
    const cookies = setCookies(response);

    expect(response.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("scope")).toBe("repo");
    expect(location.searchParams.has("client_secret")).toBe(false);
    expect(cookies).toHaveLength(1);
    expectFlags(cookies[0], STATE_COOKIE, 600);
    const state = location.searchParams.get("state")!;
    expect(state.length).toBeGreaterThanOrEqual(16);
    expect(cookies[0].split(";")[0]).toBe(stateCookie(state));
  });

  it("uses a new state each time", () => {
    const state = () => new URL(login().headers.get("location")!).searchParams.get("state");

    expect(state()).not.toBe(state());
  });

  it("answers 500 and sets no cookie when GITHUB_CLIENT_ID is missing", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", undefined);
    const response = login();

    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("GITHUB_CLIENT_ID");
    expect(setCookies(response)).toEqual([]);
  });
});

describe("callback", () => {
  it("answers 404 in local mode, with no GitHub call", async () => {
    vi.stubEnv("ADMIN", undefined);
    const fetchMock = stubGitHub();
    const response = await callback(callbackRequest("code=abc&state=s1", stateCookie("s1")));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Each of these has a code, so only the state check can refuse it. GitHub must not be called.
  it.each<[string, string, string | undefined]>([
    ["no state cookie", "code=abc&state=s1", undefined],
    ["an empty state cookie", "code=abc&state=", stateCookie("")],
    ["no state in the URL", "code=abc", stateCookie("s1")],
    ["a different state", "code=abc&state=s2", stateCookie("s1")],
    ["a longer state", "code=abc&state=s1x", stateCookie("s1")],
    ["a shorter state that starts the cookie's", "code=abc&state=s", stateCookie("s1")],
    ["a state that only differs in case", "code=abc&state=S1", stateCookie("s1")],
    ["a multi-byte state of the same string length", "code=abc&state=%C3%A9%C3%A9", stateCookie("ee")],
    ["the state in another cookie", "code=abc&state=s1", `other=s1`],
  ])("answers 400 for %s, with no GitHub call and no session", async (_, query, cookie) => {
    const fetchMock = stubGitHub();
    const response = await callback(callbackRequest(query, cookie));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionCookieSet(response)).toBeUndefined();
  });

  it("answers 400 when GitHub sent no code (the user said no), with no GitHub call", async () => {
    const fetchMock = stubGitHub();
    const response = await callback(callbackRequest("error=access_denied&state=s1", stateCookie("s1")));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 500 and makes no GitHub call when the OAuth App's id or secret is missing", async () => {
    for (const name of ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]) {
      vi.stubEnv(name, undefined);
      const fetchMock = stubGitHub();
      const response = await callback(callbackRequest("code=abc&state=s1", stateCookie("s1")));

      expect(response.status).toBe(500);
      expect((await response.json()).error).toContain(name);
      expect(fetchMock).not.toHaveBeenCalled();
      vi.stubEnv(name, "set-again");
    }
  });

  it("signs AmerPupo in: a session cookie, the state cookie cleared, and a redirect to /admin", async () => {
    const fetchMock = stubGitHub();
    const before = Date.now();
    const response = await callback(callbackRequest("code=the-code&state=s1", stateCookie("s1")));
    const cookies = setCookies(response);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${SITE}/admin`);

    expect(cookies).toHaveLength(2);
    const session = sessionCookieSet(response)!;
    expectFlags(session, SESSION_COOKIE, 8 * 60 * 60);
    const cleared = cookies.find((c) => c.startsWith(`${STATE_COOKIE}=;`))!;
    expectFlags(cleared, STATE_COOKIE, 0);

    const opened = openSession(session.split(";")[0].slice(SESSION_COOKIE.length + 1));
    expect(opened).toMatchObject({ login: "AmerPupo", token: TOKEN });
    expect(opened!.exp).toBeGreaterThanOrEqual(before + 8 * 60 * 60 * 1000);
    expect(opened!.exp).toBeLessThanOrEqual(Date.now() + 8 * 60 * 60 * 1000);

    // The code goes to GitHub with the app's id and secret, and the token it returns is used for GET /user.
    const [[exchangeUrl, exchangeInit], [userUrl, userInit]] = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(exchangeUrl).toBe(EXCHANGE_URL);
    expect(exchangeInit.method).toBe("POST");
    expect(JSON.parse(exchangeInit.body as string)).toEqual({ client_id: "test-client-id", client_secret: "test-client-secret", code: "the-code" });
    expect(userUrl).toBe(USER_URL);
    expect(new Headers(userInit.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("puts the token in no response body, redirect URL, plain cookie or log line", async () => {
    stubGitHub();
    const response = await callback(callbackRequest("code=abc&state=s1", stateCookie("s1")));
    const everything = [await response.text(), response.headers.get("location"), ...setCookies(response)].join("\n");

    expect(everything).not.toContain(TOKEN);
    const sealed = sessionCookieSet(response)!.split(";")[0].slice(SESSION_COOKIE.length + 1);
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toContain(TOKEN);
    nothingLogged();
  });

  // GitHub logins are unique and it returns the canonical case, so an exact match is right, and a look-alike is another account.
  it.each(["octocat", "amerpupo", "AMERPUPO", "AmerPupo2", "AmerPupo ", " AmerPupo", "Amer-Pupo", "AmerPup0", ""])(
    "answers 403 and sets no session for the login %j, and says nothing about the token",
    async (name) => {
      stubGitHub({ user: { body: { login: name } } });
      const response = await callback(callbackRequest("code=abc&state=s1", stateCookie("s1")));
      const body = await response.text();

      expect(response.status).toBe(403);
      expect(sessionCookieSet(response)).toBeUndefined();
      expect(body).not.toContain(TOKEN);
      // The state is single-use, even when sign-in is refused.
      expect(setCookies(response).some((c) => c.startsWith(`${STATE_COOKIE}=;`))).toBe(true);
      nothingLogged();
    },
  );

  it.each<[string, unknown]>([
    ["no login", {}],
    ["a numeric login", { login: 5 }],
    ["a null login", { login: null }],
    ["an array", ["AmerPupo"]],
  ])("answers 403 for a /user reply with %s", async (_, body) => {
    stubGitHub({ user: { body } });
    const response = await callback(callbackRequest("code=abc&state=s1", stateCookie("s1")));

    expect(response.status).toBe(403);
    expect(sessionCookieSet(response)).toBeUndefined();
  });

  it.each<[string, Step]>([
    ["GitHub's error in a 200 reply", { body: { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." } }],
    ["a non-OK status", { status: 500, body: { error: "server_error" } }],
    ["a reply with no token", { body: { scope: "repo" } }],
    ["a reply with an empty token", { body: { access_token: "" } }],
    ["a reply that isn't JSON", { body: "<html>" }],
    ["a network failure", new Error("fetch failed")],
  ])("answers 502 for a failed code exchange: %s, with no /user call", async (_, exchange) => {
    const fetchMock = stubGitHub({ exchange });
    const response = await callback(callbackRequest("code=abc&state=s1", stateCookie("s1")));

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sessionCookieSet(response)).toBeUndefined();
    nothingLogged();
  });

  it("passes GitHub's own message on", async () => {
    stubGitHub({ exchange: { body: { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." } } });
    const response = await callback(callbackRequest("code=abc&state=s1", stateCookie("s1")));

    expect((await response.json()).error).toContain("The code passed is incorrect or expired.");
  });

  it.each<[string, Step]>([
    ["a 401 (bad credentials)", { status: 401, body: { message: "Bad credentials" } }],
    ["a network failure", new Error("fetch failed")],
  ])("answers 502 when GET /user fails: %s", async (_, user) => {
    stubGitHub({ user });
    const response = await callback(callbackRequest("code=abc&state=s1", stateCookie("s1")));

    expect(response.status).toBe(502);
    expect(sessionCookieSet(response)).toBeUndefined();
  });

  it("answers 500, naming SESSION_SECRET, when it can't seal a session", async () => {
    vi.stubEnv("SESSION_SECRET", undefined);
    stubGitHub();
    const response = await callback(callbackRequest("code=abc&state=s1", stateCookie("s1")));

    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("SESSION_SECRET");
    expect(sessionCookieSet(response)).toBeUndefined();
  });
});

describe("logout", () => {
  const request = (headers: Record<string, string>) => new Request(`${SITE}/api/admin/auth/logout`, { method: "POST", headers });
  const SAME_SITE = { host: HOST, origin: SITE };

  it("answers 404 in local mode", () => {
    vi.stubEnv("ADMIN", undefined);

    expect(logout(request(SAME_SITE)).status).toBe(404);
  });

  it.each<[string, Record<string, string>]>([
    ["no Origin", { host: HOST }],
    ["a foreign Origin", { host: HOST, origin: "https://example.com" }],
    ["an http Origin", { host: HOST, origin: `http://${HOST}` }],
    ["a look-alike Origin", { host: HOST, origin: `https://${HOST}.evil.com` }],
    ["an Origin and no Host", { origin: "https://null" }],
  ])("answers 403 for %s, and the session stays", (_, headers) => {
    const response = logout(request(headers));

    expect(response.status).toBe(403);
    expect(setCookies(response)).toEqual([]);
  });

  it("clears the session cookie and redirects to /admin, with or without a session", () => {
    for (const cookie of [undefined, `${SESSION_COOKIE}=garbage`]) {
      const response = logout(request(cookie === undefined ? SAME_SITE : { ...SAME_SITE, cookie }));
      const cookies = setCookies(response);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${SITE}/admin`);
      expect(cookies).toHaveLength(1);
      expectFlags(cookies[0], SESSION_COOKIE, 0);
      expect(cookies[0].startsWith(`${SESSION_COOKIE}=;`)).toBe(true);
    }
  });
});
