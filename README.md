# pupo

Portfolio site of Amer Jašarević: a static site built with Next.js, React, TypeScript and Tailwind CSS. The home page has the name, a short bio, a CV download and an index of projects, each project has its own page, and every page ends with the contact links. The projects are data in `content/projects.json`.

## Admin (development only)

`npm run dev` also serves `/admin` on `127.0.0.1`. It lists the GitHub repositories through the `gh` CLI, drafts a project entry for a public one with the Claude Code CLI (`claude -p`, signed in with a subscription, no API key) and writes `content/projects.json`. Only public repositories can be drafted or published.

None of this ships in the public site. Its production build is a static export, the admin files count as routes only under `next dev` (or the online admin below), and a `postbuild` check fails the build if an `admin` or `api` path ever reaches `out/`.

## Online admin

The same admin also runs online, as a second Vercel project built from this repo, so projects can be added, edited and published from a phone with no dev server. **Sign in with GitHub** lets in the `AmerPupo` account only, and the session lasts 8 hours.

- **Save, Publish, Unpublish and Reorder** each make one commit to `content/projects.json` on `main`, and both Vercel projects redeploy from it. If the file changed on GitHub since the page loaded, the save fails with "changed elsewhere, reload" and nothing is overwritten.
- **Generate and Regenerate** start the `Draft` workflow in GitHub Actions (`.github/workflows/draft.yml`), which clones the public repo without a token, runs the same `claude -p` command as the local admin, and hands the draft back to the page. It takes about 2 to 5 minutes. A second Generate for the same repo cancels the first, and a page reloaded during a run does not get that run's draft.
- Private repositories cannot be drafted or published online: the server checks, and the workflow clones with no token.

It is made of three pieces. None of their values is in this repo.

| Piece | What it is | Where |
|---|---|---|
| GitHub OAuth App | Sign-in, scope `repo`. Callback URL `https://pupo-admin.vercel.app/api/admin/auth/callback`. | GitHub → Settings → Developer settings → OAuth Apps |
| `pupo-admin` Vercel project | This repo, production branch `main`, with the variables `ADMIN=1`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `SESSION_SECRET` (32 random bytes in base64: `openssl rand -base64 32`). `pupo-portfolio` is the public project and has none of them. | Vercel → Project → Settings → Environment Variables |
| `CLAUDE_CODE_OAUTH_TOKEN` | Lets the workflow run `claude` on the Claude subscription. Drafts count against the plan's usage limits. | Repo secret: `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R AmerPupo/pupo` |

**Renew the Claude token.** When Generate fails, the error links to the run. If its Draft step shows a login error, run `claude setup-token` in a normal terminal and set the secret again with the `gh secret set` command above (it asks for the token, so it never goes in a file).

**Revoke the GitHub token.** Sign out only clears the cookie. To revoke the access itself, go to GitHub → Settings → Applications → Authorized OAuth Apps → this app → Revoke. Changing `SESSION_SECRET` in Vercel also invalidates every session at once.

**Before using the local admin after online edits, run `git pull`.** Online saves are commits on `main`, so the local `content/projects.json` is behind until you do.

## Commands

```bash
npm ci          # install
npm run dev     # dev server with the admin, at http://127.0.0.1:3000
npm test        # Vitest
npm run lint    # ESLint
npm run build   # static export to out/, then the postbuild check
ADMIN=1 npm run build   # the online admin's build: a server build with the admin routes (the postbuild check skips itself)
```

Needs Node 22. The local admin also needs `gh` and `claude`, both logged in.

All rights reserved.
