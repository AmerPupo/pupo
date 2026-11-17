import { describe, expect, it } from "vitest";
import { isLocalHost, isLocalOrigin, localOnly } from "./origin";

describe("isLocalOrigin", () => {
  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://127.0.0.1:3217", "http://localhost:80"])(
    "accepts %s",
    (origin) => {
      expect(isLocalOrigin(origin)).toBe(true);
    },
  );

  it("rejects a request with no Origin header", () => {
    expect(isLocalOrigin(null)).toBe(false);
  });

  // Each of these starts like a local origin, or contains one, but is not one.
  it.each([
    "",
    "null",
    "https://localhost:3000",
    "http://localhost",
    "http://localhost:",
    "http://localhost:3000/",
    "http://localhost:3000/admin",
    "http://localhost:123456",
    "http://localhost.evil.com:3000",
    "http://127.0.0.1.evil.com:3000",
    "http://localhost:3000@evil.com",
    "http://evil.com/?http://localhost:3000",
    "http://evil.com",
    "http://[::1]:3000",
    " http://localhost:3000",
    "http://localhost:3000\n",
  ])("rejects %j", (origin) => {
    expect(isLocalOrigin(origin)).toBe(false);
  });
});

describe("isLocalHost", () => {
  it.each(["localhost:3000", "127.0.0.1:3000", "127.0.0.1:3217", "localhost:80"])("accepts %s", (host) => {
    expect(isLocalHost(host)).toBe(true);
  });

  it("rejects a request with no Host header", () => {
    expect(isLocalHost(null)).toBe(false);
  });

  // A DNS-rebinding page is served from a name of its own that resolves to 127.0.0.1, so its Host is that name. These all start like a
  // local host, or contain one, but are not one.
  it.each([
    "",
    "localhost",
    "127.0.0.1",
    "localhost:",
    "localhost:123456",
    "[::1]:3000",
    "localhost.evil.com:3000",
    "127.0.0.1.evil.com:3000",
    "localhost:3000@evil.com",
    "user@localhost:3000",
    "evil.example:3000",
    "evil.example",
    "http://localhost:3000",
    "localhost:3000/",
    "LOCALHOST:3000",
    " localhost:3000",
    "localhost:3000\n",
  ])("rejects %j", (host) => {
    expect(isLocalHost(host)).toBe(false);
  });
});

describe("localOnly", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://127.0.0.1:3000/api/admin/x", { method: "POST", headers });
  const LOCAL = { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" };

  it("lets a request from a local page through, as null", () => {
    expect(localOnly(request(LOCAL))).toBeNull();
    expect(localOnly(request({ origin: "http://localhost:3217", host: "localhost:3217" }))).toBeNull();
  });

  it.each<[string, Record<string, string>]>([
    ["no Origin", { host: LOCAL.host }],
    ["a foreign Origin", { ...LOCAL, origin: "https://example.com" }],
    ["a look-alike Origin", { ...LOCAL, origin: "http://localhost.evil.com:3000" }],
    ["a local Origin and no Host", { origin: LOCAL.origin }],
    ["a local Origin and a foreign Host", { ...LOCAL, host: "evil.example:3000" }],
    ["a local Origin and a look-alike Host", { ...LOCAL, host: "localhost.evil.com:3000" }],
    ["a foreign Origin and a foreign Host", { origin: "https://evil.example:3000", host: "evil.example:3000" }],
  ])("answers 403 with the same message for %s", async (_, headers) => {
    const response = localOnly(request(headers));

    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
    expect(await response!.json()).toEqual({
      error: "Admin requests must come from a page on http://localhost or http://127.0.0.1.",
    });
  });
});
