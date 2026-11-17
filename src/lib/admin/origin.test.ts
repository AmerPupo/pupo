import { describe, expect, it } from "vitest";
import { isLocalOrigin } from "./origin";

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
