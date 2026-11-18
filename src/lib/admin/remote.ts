const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`GitHub answered ${status}: ${body.slice(0, 200)}`);
  }
}

// One GitHub REST call with the signed-in user's token. The token is only ever a request header: it is not in any error message.
export async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...init.headers },
  });
  if (!response.ok) throw new GitHubError(response.status, await response.text());
  return (response.status === 204 ? undefined : await response.json()) as T;
}
