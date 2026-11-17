import { rename, rm, writeFile } from "node:fs/promises";
import { PROJECTS_FILE, type Project } from "../projects";

// Write a temp file next to the real one, then rename it over the real one, so a crash can't leave projects.json half-written.
// 2-space indent and a trailing newline keep the git diff down to the lines that changed.
export async function writeProjects(projects: Project[], file = PROJECTS_FILE): Promise<void> {
  const temp = `${file}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(projects, null, 2)}\n`);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
