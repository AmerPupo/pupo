import type { Project } from "../projects";

// The publish guard: slugs of published projects whose repo is not in `publicRepos` (the names gh reports as PUBLIC).
// A repo that was renamed, deleted or made private is missing or non-public, so this fails closed.
// Unpublished projects are never checked, which is what lets them still be saved and taken down.
export function publishedButNotPublic(projects: Project[], publicRepos: ReadonlySet<string>): string[] {
  return projects.filter((project) => project.published && !publicRepos.has(project.slug)).map((project) => project.slug);
}
