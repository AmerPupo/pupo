// Runner entry for .github/workflows/draft.yml: drafts the clone in CLONE_DIR with the same generateDraft the local admin uses.
// Success writes only the Draft to `out`. Failure prints only the error message (never the draft, never env) and exits 1.
import { writeFile } from "node:fs/promises";
import { generateDraft } from "../src/lib/admin/claude";

export async function main(env: Record<string, string | undefined>, out = "draft.json"): Promise<number> {
  const { CLONE_DIR, NOTE } = env;
  if (!CLONE_DIR) {
    console.error("CLONE_DIR is not set.");
    return 1;
  }
  try {
    await writeFile(out, JSON.stringify(await generateDraft(CLONE_DIR, NOTE || undefined)));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The draft failed.");
    return 1;
  }
}

// Only when run as a script (jiti scripts/draft.ts), not when a test imports main.
if (process.argv[1]?.endsWith("draft.ts")) void main(process.env).then((code) => (process.exitCode = code));
