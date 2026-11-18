import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/projects";
import { putProjects, requestDraft } from "./AdminApp";

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

// Local mode answers the POST with the draft. On the admin project the POST answers 202 { id } and the draft is fetched by asking every 10 s.
describe("requestDraft", () => {
  const ID = "2d5353c2-8075-448a-9866-e087b6fd185f";
  const RUN_URL = "https://github.com/AmerPupo/pupo/actions/runs/44333477534";
  const REPLY = { name: "Demo", tagline: "A demo.", description: "I built it.", tech: ["TypeScript"], repoUrl: "https://github.com/AmerPupo/demo" };

  type Answer = { status?: number; body: unknown } | Error;

  // The answers come one per fetch, in order. A run that never ends is the last answer repeated.
  function stubAnswers(...answers: Answer[]) {
    let next = 0;
    const mock = vi.fn<typeof fetch>(async () => {
      const answer = answers[Math.min(next++, answers.length - 1)];
      if (answer instanceof Error) throw answer;
      return Response.json(answer.body, { status: answer.status ?? 200 });
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }
  const started = { status: 202, body: { id: ID } };
  const pending = (runUrl?: string) => ({ status: 202, body: { status: "pending", runUrl } });
  const urls = (mock: ReturnType<typeof stubAnswers>) => mock.mock.calls.map(([url]) => String(url));
  const noWait = () => vi.fn<(ms: number) => Promise<void>>(async () => undefined);

  it("returns the draft the local server answers with, and never polls", async () => {
    const mock = stubAnswers({ body: REPLY });
    const wait = noWait();
    const onPending = vi.fn();

    expect(await requestDraft("demo", "focus on the backend", onPending, wait)).toEqual(REPLY);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe("/api/admin/draft");
    expect((mock.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(sentBody(mock)).toEqual({ name: "demo", note: "focus on the backend" });
    expect(wait).not.toHaveBeenCalled();
    expect(onPending).not.toHaveBeenCalled();
  });

  it("after a 202, asks every 10 s with the id and the name until the draft comes", async () => {
    const mock = stubAnswers(started, pending(), pending(RUN_URL), { body: REPLY });
    const wait = noWait();

    expect(await requestDraft("demo", "", vi.fn(), wait)).toEqual(REPLY);
    expect(urls(mock)).toEqual(["/api/admin/draft", `/api/admin/draft?id=${ID}&name=demo`, `/api/admin/draft?id=${ID}&name=demo`, `/api/admin/draft?id=${ID}&name=demo`]);
    for (const [, init] of mock.mock.calls.slice(1)) {
      expect((init as RequestInit).method).toBe("GET");
      expect((init as RequestInit).body).toBeUndefined();
    }
    expect(wait.mock.calls).toEqual([[10_000], [10_000], [10_000]]);
  });

  it("reports the run while it waits: first with no URL, then with the URL once there is one", async () => {
    stubAnswers(started, pending(), pending(RUN_URL), { body: REPLY });
    const onPending = vi.fn();
    await requestDraft("demo", "", onPending, noWait());

    expect(onPending.mock.calls).toEqual([[undefined], [undefined], [RUN_URL]]);
  });

  it("shows the server's message when the POST is refused, and never polls", async () => {
    const mock = stubAnswers({ status: 400, body: { error: '"notes" is private. Only public repositories can be drafted.' } });

    await expect(requestDraft("notes", "", vi.fn(), noWait())).rejects.toThrow(/is private/);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("stops with the server's message, run URL included, when the run failed", async () => {
    const mock = stubAnswers(started, { status: 500, body: { error: `The run finished (failure) without a draft. ${RUN_URL}` } });
    const error = await requestDraft("demo", "", vi.fn(), noWait()).catch((e: unknown) => e);

    expect((error as Error).message).toBe(`The run finished (failure) without a draft. ${RUN_URL}`);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it.each<[string, Answer]>([
    ["a 401, the session is gone", { status: 401, body: { error: "Sign in with GitHub first." } }],
    ["a 400", { status: 400, body: { error: "name must be a repository name" } }],
    ["a 404", { status: 404, body: { error: "Not found." } }],
  ])("stops at once on %s", async (_, answer) => {
    const mock = stubAnswers(started, answer);

    await expect(requestDraft("demo", "", vi.fn(), noWait())).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  // GitHub having a bad moment, or a phone losing signal, is no reason to throw away a run that is still going.
  it.each<[string, Answer]>([
    ["a 502", { status: 502, body: { error: "GitHub answered 503: unavailable" } }],
    ["a lost connection", new TypeError("Failed to fetch")],
  ])("asks again after %s", async (_, trouble) => {
    const mock = stubAnswers(started, trouble, { body: REPLY });

    expect(await requestDraft("demo", "", vi.fn(), noWait())).toEqual(REPLY);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("gives up after 15 minutes, which is 90 questions 10 s apart", async () => {
    const mock = stubAnswers(started, pending(RUN_URL));
    const wait = noWait();

    await expect(requestDraft("demo", "", vi.fn(), wait)).rejects.toThrow(/15 minutes/);
    expect(wait).toHaveBeenCalledTimes(90);
    expect(mock).toHaveBeenCalledTimes(91);
  });

  it("names the run in the message when it gives up, so it can be opened", async () => {
    stubAnswers(started, pending(RUN_URL));

    await expect(requestDraft("demo", "", vi.fn(), noWait())).rejects.toThrow(RUN_URL);
  });

  it("fails when a 202 doesn't say which run to wait for", async () => {
    const mock = stubAnswers({ status: 202, body: {} });

    await expect(requestDraft("demo", "", vi.fn(), noWait())).rejects.toThrow(/which run/);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
