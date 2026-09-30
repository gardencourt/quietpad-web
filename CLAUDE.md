# CLAUDE.md — read this first

This file is for you, Claude, not the user — it's loaded automatically at
the start of any session rooted in this folder. It exists because the
detailed project history for this app actually lives in a *different*
repo's Claude Code memory (`ownote`, the Android app this is being rebuilt
from), which a session here has no automatic access to.

## What this project is

QuietPad web — a browser notes app (Google Drive-backed, with a local-
folder alternative), being built to match the features of the QuietPad
Android app (`gardencourt/ownote`). No backend of our own: every Drive call
goes straight from the browser to Google's API using the signed-in user's
own token.

## Read this before doing anything else

**`ANDROID-PARITY-HANDOFF.md`** (repo root) is the actual spec: the full
Android feature reference to replicate, this web app's current real state
and known gaps, the Cloud Console setup gotcha, and the pending Cloudflare/
DNS work. Read it in full before making changes — this file only covers
how to work here, not what to build.

## Repo/branch state — do not merge to main without checking this first

- **`main`** is what `quietpad.co.uk` actually serves live today (an older,
  static single-file editor, via GitHub Pages/IONOS DNS).
- **`web-app`** has all the real, current work (Preact + Vite notes app) —
  branch off this, not `main`.
- `web-app` must **not** be merged into `main` until `quietpad.co.uk`'s DNS
  has actually moved to Cloudflare (see `ANDROID-PARITY-HANDOFF.md`) —
  merging first would replace the live site with an app the domain can't
  yet serve correctly. If asked to merge or deploy to production, check
  this has happened; if you can't tell, ask rather than assume.

## Working style (carried over from the Android project — same person, same expectations)

- **Fix reported gaps immediately and verify live** — if the user reports
  something broken or missing while trying the app, that's an implicit
  request to build/fix it now, scoped to what was actually asked, not to
  catalogue it as future work. "Verify live" here means actually running
  it (`npm run dev`, or the deployed preview) and checking in a real
  browser — via `claude-in-chrome` when available, or a manual describe-
  and-confirm loop with the user — not just reading the diff and calling
  it done.
- **Commit messages explain the *why*, not just the *what***: what report
  or request prompted the change, what the real root cause was if it was a
  bug, and what was actually verified before committing. Match the density
  and tone of `ownote`'s own commit history if you want a concrete example
  (`git log` there).
- **Ask before big design/architecture calls** (a new dependency, a schema/
  data-shape change, anything hard to reverse) — use a short set of
  concrete options, not an open-ended question. Don't ask for things with
  an obvious default; just note the choice you made and move on.
- **Don't scope-creep.** A request to fix one thing is a request to fix
  that thing — note adjacent gaps you notice rather than fixing them
  unasked, unless they're trivial and directly in the way.
- No destructive git operations (force-push, hard reset, deleting a
  branch) without the user explicitly asking for that specific action.

## Working here, practically

- `npm run dev` → `http://localhost:5173/edit/` (already an authorized
  OAuth origin — see the Cloud Console note in `ANDROID-PARITY-HANDOFF.md`,
  don't create a second Cloud project).
- No test suite exists yet (`package.json` has no `test` script) — changes
  are verified by actually running the app, including the dev-only
  `?demo` (in-memory fake data, no auth) and `?demo=opfs` (a real local-
  folder backend against the browser's own sandboxed storage) modes for
  checking backend logic without touching a real Drive account or folder.
- Local-folder mode (File System Access API) only works in Chromium
  browsers (Chrome/Edge) — don't file a Firefox/Safari gap in that mode as
  a bug.
- If you make a real change to what this app does or how it's built,
  update `ANDROID-PARITY-HANDOFF.md`'s gaps/status sections to match —
  keep it current for whoever (human or Claude) reads it next, the same
  way `ownote`'s own status memory gets updated after real work there.
