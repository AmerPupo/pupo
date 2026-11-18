import type { Project } from "../projects";

// The home page lists the first HOME_LIMIT published projects. Kept here, not in projects.ts, because the admin runs in the browser.
export const HOME_LIMIT = 5;
export const shownOnHome = (projects: Project[]): Project[] =>
  projects.filter((project) => project.published).slice(0, HOME_LIMIT);

// The array order is the home page order, and the home page shows published projects only. So a move swaps with the
// nearest published project in that direction, and drafts in between stay in their own slots.
// Returns null when there is nothing to swap with (a draft, an unknown slug, or already first or last), which the UI uses to disable the button.
export function moveProject(projects: Project[], slug: string, step: -1 | 1): Project[] | null {
  const from = projects.findIndex((project) => project.slug === slug);
  if (from < 0 || !projects[from].published) return null;

  let to = from + step;
  while (projects[to] && !projects[to].published) to += step;
  if (!projects[to]) return null;

  const moved = [...projects];
  [moved[from], moved[to]] = [moved[to], moved[from]];
  return moved;
}

// Save replaces the project with the same slug, or appends it. A draft that was just generated is not in the list yet,
// and replacing by slug alone would drop it while the save still looked like it worked.
// Returns null when the entry is already exactly `updated`, so a Save that changes nothing sends nothing (it would be an empty commit that rebuilds both sites).
// "Exactly" is JSON.stringify, the form the file gets: an undefined demoUrl and an absent one are the same file.
export function upsertProject(projects: Project[], updated: Project): Project[] | null {
  const current = projects.find((project) => project.slug === updated.slug);
  if (!current) return [...projects, updated];
  if (JSON.stringify(current) === JSON.stringify(updated)) return null;
  return projects.map((project) => (project.slug === updated.slug ? updated : project));
}
