import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./assert-no-admin.mjs", import.meta.url));
const scratchDirs: string[] = [];

// Runs the guard in a scratch project whose out/ holds `files` (null: no out/ at all).
function runGuard(files: string[] | null) {
  const cwd = mkdtempSync(join(tmpdir(), "assert-no-admin-"));
  scratchDirs.push(cwd);
  if (files) {
    mkdirSync(join(cwd, "out"));
    for (const file of files) {
      const path = join(cwd, "out", file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "");
    }
  }
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("assert-no-admin", () => {
  it("passes for a clean export, even with an api page nested under projects/", () => {
    const result = runGuard(["index.html", "404.html", "projects/api.html"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ok");
  });

  it("fails and names a top-level admin page", () => {
    const result = runGuard(["index.html", "admin.html"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("out/admin.html");
  });

  it("fails and names a top-level api folder", () => {
    const result = runGuard(["index.html", "api/admin/projects"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("out/api");
  });

  it("matches the name case-insensitively", () => {
    const result = runGuard(["index.html", "Admin.html"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("out/Admin.html");
  });

  it("fails when out/ is missing", () => {
    const result = runGuard(null);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("out/ is missing");
  });
});
