import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/projects";
import { putProjects } from "./AdminApp";

const project = (slug: string): Project => ({
  slug,
  name: slug,
  tagline: "A tagline.",
  description: "A description.",
  tech: [],
  repoUrl: `https://github.com/AmerPupo/${slug}`,
  published: true,
});

function stubFetch(reply: unknown, status = 200) {
  const mock = vi.fn<typeof fetch>(async () => Response.json(reply, { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

const sentBody = (mock: ReturnType<typeof stubFetch>) => JSON.parse(String((mock.mock.calls[0][1] as RequestInit).body)) as unknown;

afterEach(() => {
  vi.unstubAllGlobals();
});

// Local mode has no sha: the body is the plain array and so is the answer. On the admin project the page hands over the file's sha,
// the body is { projects, sha }, and the answer carries the sha for the next save.
describe("putProjects", () => {
  it("without a sha, sends the plain array and returns the array the server wrote", async () => {
    const projects = [project("a"), project("b")];
    const mock = stubFetch(projects);
    const saved = await putProjects(projects, undefined);

    expect(mock.mock.calls[0][0]).toBe("/api/admin/projects");
    expect((mock.mock.calls[0][1] as RequestInit).method).toBe("PUT");
    expect(sentBody(mock)).toEqual(projects);
    expect(saved).toEqual({ projects, sha: undefined });
  });

  it("with a sha, sends { projects, sha } and returns the new sha from the answer", async () => {
    const projects = [project("a")];
    const mock = stubFetch({ projects, sha: "new-sha" });
    const saved = await putProjects(projects, "old-sha");

    expect(sentBody(mock)).toEqual({ projects, sha: "old-sha" });
    expect(saved).toEqual({ projects, sha: "new-sha" });
  });

  it("shows the server's message for a refused save, such as the 409 after an edit elsewhere", async () => {
    stubFetch({ error: "changed elsewhere, reload the page" }, 409);

    await expect(putProjects([project("a")], "old-sha")).rejects.toThrow("changed elsewhere, reload the page");
  });
});
