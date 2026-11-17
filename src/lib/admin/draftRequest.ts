import { isValidSlug } from "../projects";

export const MAX_NOTE = 500;

export type DraftRequest = { name: string; note?: string };

// The body of POST /api/admin/draft: the repo to draft, and an optional note that steers the text ("focus on the backend").
// `name` goes to gh and into a folder path, so it has to pass the same slug check as a project.
export function parseDraftRequest(raw: unknown): DraftRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error('The body must be a JSON object like { "name": "<repo>", "note": "<optional>" }.');
  }
  const { name, note } = raw as Record<string, unknown>;

  if (!isValidSlug(name)) {
    throw new Error('name must be a repository name: letters, digits, ".", "_" or "-" (not "." or "..").');
  }
  if (note !== undefined && typeof note !== "string") throw new Error("note must be a string.");

  // The page sends "" for an empty note field, which means no note.
  const trimmed = note?.trim();
  if (trimmed && trimmed.length > MAX_NOTE) {
    throw new Error(`note is ${trimmed.length} characters, the limit is ${MAX_NOTE}.`);
  }
  return { name, note: trimmed || undefined };
}
