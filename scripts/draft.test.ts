import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateDraft } from "../src/lib/admin/claude";
import { main } from "./draft";

vi.mock("../src/lib/admin/claude", () => ({ generateDraft: vi.fn() }));

const DRAFT = { name: "CareFall", tagline: "Fall detection", description: "I built it.", tech: ["TypeScript"] };

let dir: string;
let out: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "draft-run-"));
  out = join(dir, "draft.json");
  vi.mocked(generateDraft).mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("draft runner", () => {
  it("drafts the clone and writes exactly the draft to the output file", async () => {
    vi.mocked(generateDraft).mockResolvedValue(DRAFT);

    const code = await main({ CLONE_DIR: "/tmp/clone", NOTE: "stress the tests" }, out);

    expect(code).toBe(0);
    expect(generateDraft).toHaveBeenCalledWith("/tmp/clone", "stress the tests");
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(DRAFT);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("treats an empty note as no note", async () => {
    vi.mocked(generateDraft).mockResolvedValue(DRAFT);

    await main({ CLONE_DIR: "/tmp/clone", NOTE: "" }, out);

    expect(generateDraft).toHaveBeenCalledWith("/tmp/clone", undefined);
  });

  it("on failure prints only the error message, writes nothing and fails", async () => {
    vi.mocked(generateDraft).mockRejectedValue(new Error("claude timed out after 5 minutes and was stopped."));

    const code = await main({ CLONE_DIR: "/tmp/clone", CLAUDE_CODE_OAUTH_TOKEN: "sk-secret" }, out);

    expect(code).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith("claude timed out after 5 minutes and was stopped.");
    expect(console.log).not.toHaveBeenCalled();
    expect(existsSync(out)).toBe(false);
  });

  it("fails without calling claude when the clone path is missing", async () => {
    const code = await main({ NOTE: "x" }, out);

    expect(code).toBe(1);
    expect(generateDraft).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("CLONE_DIR"));
  });
});
