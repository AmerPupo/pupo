import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import fixture from "./fixtures/claude-result.json";
import {
  buildPrompt,
  childEnv,
  claudeArgs,
  explainRunError,
  generateDraft,
  parseClaudeResult,
  TIMEOUT_MS,
} from "./claude";

// generateDraft starts a real process, so the spawn is mocked and its arguments are checked instead. The real promisify(execFile) resolves
// { stdout, stderr } and hangs the child process on the promise, and a plain mock has neither, so the mock carries its own promisify.custom.
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const execFile = vi.fn();
  Object.assign(execFile, { [promisify.custom]: vi.fn() });
  return { execFile };
});
const spawn = (execFile as unknown as Record<symbol, Mock>)[promisify.custom];

// The real output of the spec's command on a public repo (plan Task 3). Error shapes have no capture, so they are hand-written variations of it.
const RAW = JSON.stringify(fixture);
const DRAFT = fixture.structured_output;
const withChanges = (changes: Record<string, unknown>) => JSON.stringify({ ...fixture, ...changes });
// JSON.stringify leaves out a key set to undefined, so this is "the result with no structured_output".
const withoutDraft = (changes: Record<string, unknown> = {}) => withChanges({ structured_output: undefined, ...changes });

describe("parseClaudeResult", () => {
  it("turns the captured claude result into a draft", () => {
    const draft = parseClaudeResult(RAW);
    expect(draft).toEqual(DRAFT);
    expect(draft.name).toBe("CareFall");
    expect(draft.tech).toHaveLength(10);
  });

  it("falls back to the draft printed as JSON text in `result`", () => {
    expect(parseClaudeResult(withoutDraft())).toEqual(DRAFT);
  });

  it("returns only the four draft fields", () => {
    const draft = parseClaudeResult(withChanges({ structured_output: { ...DRAFT, extra: "x" } }));
    expect(Object.keys(draft).sort()).toEqual(["description", "name", "tagline", "tech"]);
  });

  // The schema has no maxLength, so the limit is not enforced here: the editor's Save shows parseProjects' error instead of the draft being lost.
  it("keeps a tagline over 100 characters", () => {
    const tagline = "x".repeat(150);
    expect(parseClaudeResult(withChanges({ structured_output: { ...DRAFT, tagline } })).tagline).toBe(tagline);
  });

  it("accepts an empty tech list", () => {
    expect(parseClaudeResult(withChanges({ structured_output: { ...DRAFT, tech: [] } })).tech).toEqual([]);
  });

  describe("failed runs", () => {
    it("reports claude's own message for an error result", () => {
      const output = withoutDraft({ is_error: true, result: "Not logged in · Please run /login" });
      expect(() => parseClaudeResult(output)).toThrow(/claude reported an error: Not logged in/);
    });

    // An errored run must not hand over a draft, even when one is attached.
    it("rejects an error result that still carries a draft", () => {
      expect(() => parseClaudeResult(withChanges({ is_error: true, result: "API Error" }))).toThrow(/API Error/);
    });

    it("rejects a result whose subtype is not success, naming it", () => {
      expect(() => parseClaudeResult(withChanges({ subtype: "error_max_turns" }))).toThrow(/error_max_turns/);
    });

    it("rejects output that is not JSON, showing what was printed", () => {
      expect(() => parseClaudeResult("Warning: no stdin data received in 3s")).toThrow(
        /did not print JSON.*Warning: no stdin data received/,
      );
    });

    it("rejects empty output", () => {
      expect(() => parseClaudeResult("")).toThrow(/did not print JSON.*nothing/);
    });

    it.each(["[]", "null", "42", '"text"'])("rejects JSON that is not a result object: %s", (output) => {
      expect(() => parseClaudeResult(output)).toThrow(/result object/);
    });

    it("rejects a finished run that returned no draft", () => {
      expect(() => parseClaudeResult(withoutDraft({ result: "I could not read the repo." }))).toThrow(/no draft/);
    });
  });

  describe("a draft that does not fit the schema", () => {
    it.each<[string, unknown]>([
      ["name", undefined],
      ["name", 7],
      ["name", ""],
      ["name", "   "],
      ["tagline", undefined],
      ["tagline", ["a tagline"]],
      ["description", undefined],
      ["description", null],
      ["tech", undefined],
      ["tech", "C++"],
      ["tech", [1]],
      ["tech", [""]],
    ])("rejects %s set to %j, naming the field", (field, value) => {
      const output = withChanges({ structured_output: { ...DRAFT, [field]: value } });
      expect(() => parseClaudeResult(output)).toThrow(new RegExp(`${field} must`));
    });

    it.each([[null], [[]], ["text"], [5]])("rejects a draft that is %j", (draft) => {
      expect(() => parseClaudeResult(withChanges({ structured_output: draft }))).toThrow(/must be an object/);
    });
  });
});

describe("buildPrompt", () => {
  it("asks for a first-person entry and warns against inventing things", () => {
    const prompt = buildPrompt();
    expect(prompt).toContain("first person");
    expect(prompt).toContain("Do not invent");
  });

  it("adds the note at the end and leaves the rest alone", () => {
    const prompt = buildPrompt("focus on the backend");
    expect(prompt.startsWith(buildPrompt())).toBe(true);
    expect(prompt.endsWith("focus on the backend")).toBe(true);
  });

  it("ignores an empty note", () => {
    expect(buildPrompt("")).toBe(buildPrompt());
  });
});

// SPEC: "Ask first: changing the claude -p flags/model", and "Never: give the drafting run write, shell or network tools".
describe("claudeArgs", () => {
  it("is the spec's command, flag for flag", () => {
    const args = claudeArgs("a note");
    const schemaAt = args.indexOf("--json-schema") + 1;
    const flags = args.filter((_, index) => index !== 1 && index !== schemaAt); // the prompt and the schema text

    expect(flags).toEqual([
      "-p",
      "--safe-mode",
      "--restricted",
      "--tools",
      "Read,Glob,Grep",
      "--permission-prompts",
      "none",
      "--output-format",
      "json",
      "--json-schema",
      "--model",
      "sonnet",
      "--effort",
      "xhigh",
      "--no-session-persistence",
    ]);
    expect(args[1]).toBe(buildPrompt("a note"));
    expect(JSON.parse(args[schemaAt])).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        tagline: { type: "string" },
        description: { type: "string" },
        tech: { type: "array", items: { type: "string" } },
      },
      required: ["name", "tagline", "description", "tech"],
      additionalProperties: false,
    });
  });

  it("never uses --bare, which ignores the subscription login", () => {
    expect(claudeArgs()).not.toContain("--bare");
  });
});

describe("childEnv", () => {
  it("drops every ANTHROPIC_ variable whatever its case, so no API key or model override reaches claude", () => {
    const env = {
      ANTHROPIC_API_KEY: "key",
      ANTHROPIC_MODEL: "model",
      anthropic_base_url: "url", // Windows treats names case-insensitively
      Anthropic_Auth_Token: "token",
      PATH: "/bin",
      CLAUDECODE: "1", // Task 3: claude works with these inherited, so they stay
      CLAUDE_CODE_ENTRYPOINT: "cli",
      MY_ANTHROPIC_KEY: "x", // only the prefix counts
    };
    expect(childEnv(env)).toEqual({
      PATH: "/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      MY_ANTHROPIC_KEY: "x",
    });
  });

  it("does not change the environment it is given", () => {
    const env = { ANTHROPIC_API_KEY: "key", PATH: "/bin" };
    childEnv(env);
    expect(env).toEqual({ ANTHROPIC_API_KEY: "key", PATH: "/bin" });
  });
});

describe("explainRunError", () => {
  it("is 5 minutes, then says the run timed out", () => {
    expect(TIMEOUT_MS).toBe(5 * 60 * 1000);
    expect(explainRunError({ killed: true, message: "Command failed: claude" }).message).toMatch(
      /timed out after 5 minutes/,
    );
  });

  it("shows the reason from claude's own error result", () => {
    const stdout = withoutDraft({ is_error: true, result: "Not logged in · Please run /login" });
    expect(explainRunError({ stdout, message: "Command failed: claude" }).message).toMatch(/Not logged in/);
  });

  it("falls back to stderr when claude printed nothing", () => {
    const error = { stdout: "", stderr: "error: unknown option '--safe-mode'\n", message: "Command failed: claude" };
    expect(explainRunError(error).message).toMatch(/unknown option '--safe-mode'/);
  });

  it("falls back to the error's own message when there is no output at all (claude is not installed)", () => {
    expect(explainRunError({ message: "spawn claude ENOENT" }).message).toMatch(/spawn claude ENOENT/);
  });

  // A non-zero exit is a failure even when stdout parses, so it never reads as success.
  it("still reports a failure when a run that exited non-zero printed a good draft", () => {
    expect(explainRunError({ stdout: RAW, message: "Command failed: claude" }).message).toMatch(/Command failed/);
  });
});

// The spawn options are what keep the run safe: the clone's own files can't replace claude, no API key reaches it, a hung run is killed,
// and it doesn't wait for input. None of that shows in the parsed result, so each one is pinned here.
describe("generateDraft", () => {
  const ORIGINAL = process.env.NoDefaultCurrentDirectoryInExePath;
  let stdin: { end: Mock };
  let atSpawn: { lookup?: string };

  beforeEach(() => {
    delete process.env.NoDefaultCurrentDirectoryInExePath; // as in a plain terminal; a Claude Code session sets it itself
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    vi.stubEnv("anthropic_base_url", "url"); // Windows treats names case-insensitively
    vi.stubEnv("PUPO_TEST_KEEP", "yes");
    stdin = { end: vi.fn() };
    atSpawn = {};
    spawn.mockReset();
    // The variable is read inside the call: generateDraft leaves it set for the whole process, so looking afterwards would prove nothing.
    spawn.mockImplementation(() => {
      atSpawn.lookup = process.env.NoDefaultCurrentDirectoryInExePath;
      return Object.assign(Promise.resolve({ stdout: RAW, stderr: "" }), { child: { stdin } });
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.NoDefaultCurrentDirectoryInExePath;
    else process.env.NoDefaultCurrentDirectoryInExePath = ORIGINAL;
  });

  it("runs claude in the clone with the spec's arguments and a 5-minute timeout, and no shell", async () => {
    await generateDraft("/clones/demo-app", "a note");

    expect(spawn).toHaveBeenCalledTimes(1);
    const [file, args, options] = spawn.mock.calls[0];
    expect(file).toBe("claude");
    expect(args).toEqual(claudeArgs("a note"));
    expect(options.cwd).toBe("/clones/demo-app");
    expect(options.timeout).toBe(TIMEOUT_MS);
    expect(options).not.toHaveProperty("shell");
  });

  it("returns the draft that claude printed", async () => {
    await expect(generateDraft("/clones/demo-app")).resolves.toEqual(DRAFT);
  });

  it("gives the child no ANTHROPIC_ variable in any case, and keeps the rest of the environment", async () => {
    await generateDraft("/clones/demo-app");

    const { env } = spawn.mock.calls[0][2];
    expect(env).not.toBe(process.env);
    expect(Object.keys(env).filter((name) => /^ANTHROPIC_/i.test(name))).toEqual([]);
    expect(env.PUPO_TEST_KEEP).toBe("yes");
    expect(Object.keys(env).some((name) => /^path$/i.test(name))).toBe(true);
  });

  it("closes the child's stdin, because left open claude waits 3 s for piped input", async () => {
    await generateDraft("/clones/demo-app");
    expect(stdin.end).toHaveBeenCalledTimes(1);
  });

  it("sets NoDefaultCurrentDirectoryInExePath to 1 before it spawns, so a claude.exe in the clone is not run", async () => {
    expect(process.env.NoDefaultCurrentDirectoryInExePath).toBeUndefined();
    await generateDraft("/clones/demo-app");
    expect(atSpawn.lookup).toBe("1");
  });

  it("reports a run that was killed by the timeout", async () => {
    const killed = Object.assign(new Error("Command failed: claude"), { killed: true });
    spawn.mockImplementation(() => Object.assign(Promise.reject(killed), { child: { stdin } }));
    await expect(generateDraft("/clones/demo-app")).rejects.toThrow(/timed out after 5 minutes/);
  });

  it("reports claude's own failure when it can't start", async () => {
    const missing = new Error("spawn claude ENOENT");
    spawn.mockImplementation(() => Object.assign(Promise.reject(missing), { child: { stdin } }));
    await expect(generateDraft("/clones/demo-app")).rejects.toThrow(/spawn claude ENOENT/);
  });
});
