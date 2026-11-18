# pupo

Portfolio site of Amer Jašarević: a static site built with Next.js, React, TypeScript and Tailwind CSS. The home page has the name, a short bio, a CV download and an index of projects, each project has its own page, and every page ends with the contact links. The projects are data in `content/projects.json`.

## Admin (development only)

`npm run dev` also serves `/admin` on `127.0.0.1`. It lists the GitHub repositories through the `gh` CLI, drafts a project entry for a public one with the Claude Code CLI (`claude -p`, signed in with a subscription, no API key) and writes `content/projects.json`. Only public repositories can be drafted or published.

None of this ships. The production build is a static export, the admin files count as routes only under `next dev`, and a `postbuild` check fails the build if an `admin` or `api` path ever reaches `out/`.

## Commands

```bash
npm ci          # install
npm run dev     # dev server with the admin, at http://127.0.0.1:3000
npm test        # Vitest
npm run lint    # ESLint
npm run build   # static export to out/, then the postbuild check
```

Needs Node 22. The admin also needs `gh` and `claude`, both logged in.

All rights reserved.
