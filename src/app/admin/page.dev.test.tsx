import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listRepos } from "@/lib/admin/github";
import { readProjects } from "@/lib/projects";
import AdminPage from "./page.dev";

// The page lists every repo, private names included, so a request under a foreign Host must get a 404 before gh is even asked.
// The real notFound() throws a special error that Next turns into the 404 page, so the mock throws too.
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/admin/github", () => ({ listRepos: vi.fn() }));
vi.mock("@/lib/projects", () => ({ readProjects: vi.fn() }));
vi.mock("@/components/admin/AdminApp", () => ({ AdminApp: () => null }));

const asHost = (host: string | null) =>
  vi.mocked(headers).mockResolvedValue(new Headers(host === null ? {} : { host }) as unknown as Awaited<ReturnType<typeof headers>>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listRepos).mockResolvedValue([]);
  vi.mocked(readProjects).mockResolvedValue([]);
});

describe("the admin page", () => {
  it.each(["localhost:3000", "127.0.0.1:3217"])("renders for the local host %s", async (host) => {
    asHost(host);
    expect(await AdminPage()).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
    expect(listRepos).toHaveBeenCalledTimes(1);
  });

  // The page answers 404 and loads nothing: no gh call, no read of projects.json.
  it.each<[string, string | null]>([
    ["a foreign host", "evil.example:3217"],
    ["a look-alike host", "localhost.evil.com:3217"],
    ["a look-alike with a local name inside", "127.0.0.1.evil.com:3217"],
    ["no port", "localhost"],
    ["no Host header", null],
  ])("answers 404 for %s, before it asks gh for anything", async (_, host) => {
    asHost(host);
    await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(listRepos).not.toHaveBeenCalled();
    expect(readProjects).not.toHaveBeenCalled();
  });
});
