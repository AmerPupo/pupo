import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isText } from "../projects";

const execFileAsync = promisify(execFile);

export const TIMEOUT_MS = 5 * 60 * 1000;

export type Draft = { name: string; tagline: string; description: string; tech: string[] };

// What POST /api/admin/draft answers with: the draft plus the repo's links. demoUrl is absent when the repo has no usable homepage.
// The route builds it and the admin page reads it, both through this type, so changing one side without the other fails the type-check.
export type DraftReply = Draft & { repoUrl: string; demoUrl?: string };

// The draft prompt: first person, plain-text paragraphs, a tagline of at most 100 characters. A regenerate note is added at the end.
const PROMPT = `You are helping me write the portfolio entry for one of my own software projects. The current directory is a clone of its GitHub repository.

Explore it with the Read, Glob and Grep tools. Start with the README and any manifest file (package.json, pyproject.toml, requirements.txt, *.csproj and so on), then read the main source files. Only say what the code or README supports. Do not invent features, numbers, users or deployments.

Write the entry in the first person, as the author ("I built...", "I used..."), for a recruiter who reads quickly:
- name: the project's display name.
- tagline: one sentence of at most 100 characters.
- description: two or three short paragraphs of plain text, separated by a blank line. No markdown: no headings, lists, bold or backticks. Say what it does, how it is built, and what I would highlight.
- tech: the main languages, frameworks and services it uses, as short names such as "TypeScript", "Next.js" or "PostgreSQL".`;

// The tagline limit is only in the prompt: adding maxLength here would change the proven command. parseProjects is the real check.
const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    tagline: { type: "string" },
    description: { type: "string" },
    tech: { type: "array", items: { type: "string" } },
  },
  required: ["name", "tagline", "description", "tech"],
  additionalProperties: false,
};

export function buildPrompt(note?: string): string {
  return note ? `${PROMPT}\n\nA note from me about this draft. Follow it where the code supports it: ${note}` : PROMPT;
}

// The draft command, flag for flag. Changing a flag or the model needs the author's OK first, and --bare must never be used (it ignores the subscription login).
export function claudeArgs(note?: string): string[] {
  return [
    "-p", buildPrompt(note),
    "--safe-mode", "--restricted",
    "--tools", "Read,Glob,Grep",
    "--permission-prompts", "none",
    "--output-format", "json", "--json-schema", JSON.stringify(DRAFT_SCHEMA),
    "--model", "sonnet", "--effort", "xhigh",
    "--no-session-persistence",
  ];
}

// The child gets process.env minus ANTHROPIC_*, so no API key, base URL or model override can switch billing to the API or change the model.
// Windows keeps a variable's name in whatever case it was set in, so the match ignores case.
// Next types NODE_ENV as always present on ProcessEnv, which a plain copy can't prove, hence the cast: the copy has it whenever process.env does.
export function childEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^ANTHROPIC_/i.test(name))) as NodeJS.ProcessEnv;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const excerpt = (text: string, limit = 200) => text.trim().slice(0, limit) || "nothing";

function toDraft(value: unknown): Draft {
  const invalid = (problem: string) => new Error(`The draft from claude is invalid: ${problem}.`);
  if (!isObject(value)) throw invalid("it must be an object");

  const { name, tagline, description, tech } = value;
  if (!isText(name)) throw invalid("name must be a non-empty string");
  if (!isText(tagline)) throw invalid("tagline must be a non-empty string");
  if (!isText(description)) throw invalid("description must be a non-empty string");
  if (!Array.isArray(tech) || !tech.every(isText)) throw invalid("tech must be a list of non-empty strings");
  return { name, tagline, description, tech };
}

// What `claude -p --output-format json` prints is one result object. The draft is its `structured_output` (`result` holds the same
// object as JSON text, so that is the fallback). `stop_reason` is "tool_use" even on success, so it is not used.
// The tagline limit is not checked here: a draft with a long one still reaches the editor, and Save shows parseProjects' error.
export function parseClaudeResult(stdout: string): Draft {
  let output: unknown;
  try {
    output = JSON.parse(stdout);
  } catch {
    throw new Error(`claude did not print JSON (it printed: ${excerpt(stdout)}).`);
  }
  if (!isObject(output)) throw new Error("claude printed JSON that is not a result object.");

  const { is_error, subtype, result, structured_output } = output;
  const badSubtype = typeof subtype === "string" && subtype !== "success";
  if (is_error === true || badSubtype) {
    const reason = typeof result === "string" && result.trim() ? `: ${excerpt(result, 300)}` : "";
    throw new Error(`claude reported an error${badSubtype ? ` (${subtype})` : ""}${reason}`);
  }

  if (structured_output !== undefined) return toDraft(structured_output);

  let fromText: unknown;
  if (typeof result === "string") {
    try {
      fromText = JSON.parse(result);
    } catch {
      // prose, not a draft: reported as "no draft" below
    }
  }
  if (fromText === undefined) throw new Error("claude finished but returned no draft.");
  return toDraft(fromText);
}

// What execFile rejects with when claude can't start, is killed by the timeout, or exits non-zero.
export type RunError = { killed?: boolean; stdout?: string; stderr?: string; message: string };

export function explainRunError({ killed, stdout, stderr, message }: RunError): Error {
  if (killed) return new Error(`claude timed out after ${TIMEOUT_MS / 60_000} minutes and was stopped.`);

  // A failed run usually still prints its JSON result, and that says why (not logged in, rate limited and so on).
  if (stdout?.trim()) {
    try {
      parseClaudeResult(stdout);
    } catch (reason) {
      return reason as Error;
    }
  }
  return new Error(`claude failed: ${stderr?.trim() || message}`);
}

// Runs claude in `cwd`, a clone of the repo, and returns its draft. Arguments go to execFile as an array, never through a shell.
export async function generateDraft(cwd: string, note?: string): Promise<Draft> {
  // On Windows execFile looks in cwd (the clone) before PATH, so a claude.exe committed to a repo would run instead of Claude. This stops that.
  process.env.NoDefaultCurrentDirectoryInExePath = "1";
  const run = execFileAsync("claude", claudeArgs(note), { cwd, env: childEnv(process.env), timeout: TIMEOUT_MS });
  run.child.stdin?.end(); // left open, claude -p waits 3 s for piped input before it starts

  let stdout: string;
  try {
    ({ stdout } = await run);
  } catch (error) {
    throw explainRunError(error as RunError);
  }
  return parseClaudeResult(stdout);
}
