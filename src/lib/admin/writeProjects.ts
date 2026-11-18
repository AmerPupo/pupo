import { rename, rm, writeFile } from "node:fs/promises";
import { PROJECTS_FILE, serializeProjects, type Project } from "../projects";

// Write a temp file next to the real one, then rename it over the real one, so a crash can't leave projects.json half-written.
export async function writeProjects(projects: Project[], file = PROJECTS_FILE): Promise<void> {
  const temp = `${file}.tmp`;
  try {
    await writeFile(temp, serializeProjects(projects));
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
