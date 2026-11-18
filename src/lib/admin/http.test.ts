import { describe, expect, it } from "vitest";
import { messageOf, reply } from "./http";

describe("reply", () => {
  it("answers with the status and a JSON { error } body", async () => {
    const response = reply(403, "Not from this site.");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Not from this site." });
  });
});

describe("messageOf", () => {
  it("is an Error's message alone, without the 'Error: ' prefix String() adds", () => {
    expect(messageOf(new Error("gh is not logged in"))).toBe("gh is not logged in");
  });

  it("is the text of anything that isn't an Error", () => {
    expect(messageOf("plain text")).toBe("plain text");
    expect(messageOf(404)).toBe("404");
  });
});
