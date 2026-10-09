# QuietPad Web — Companion Editor spec (supersedes the full notes-app scope)

**Decided 2026-10-09**, after live testing of the `web-app` branch's full
Preact notes-app rebuild showed it "needs major work." Rather than keep
building toward a standalone web notes app, the web project is now scoped
down to a **companion** to the Android app: open one note QuietPad created,
edit it, save it back to the exact same file. No note library, no search,
no multi-tab session on the web side.

This file is the current spec. `ANDROID-PARITY-HANDOFF.md` stays as the
Android feature reference (diary date-resolution rules, attachment Drive
mechanics, branding conventions, etc.) — read it for *how a feature works
on Android*, read this file for *what the web app is now scoped to build*.

## Build base: `main`, not `web-app`

`main` already has the original single-file "Notepad-style" editor
(`edit/editor.js`): Drive hand-off (`?state=`) open, Picker-based "Open from
Drive," local-device open/save via the File System Access API, debounced
autosave, file-type gating against native Google Docs/Sheets/Slides. That
is architecturally much closer to this scope than `web-app`'s sidebar/tabs/
local-folder-library rebuild is. **Build forward from `main`.** `web-app`
is not merged and is not the direction — treat it only as a source to
cherry-pick specific logic from (see below), not as a base to continue.

## Entry points (keep, already built on `main`)

- Drive "Open with QuietPad" hand-off (`?state=` query param)
- Picker-based "Open from Drive" (Notepad-style, not a full library browse)
- Local-device open/save (File System Access API) — kept as a free bonus,
  not a priority
- `drive.file` OAuth scope only, no backend of our own, same Google Cloud
  project/client as the Android app (see `ANDROID-PARITY-HANDOFF.md`'s "Key
  finding" section — do not create a second Cloud project)

## Core editing (keep + one real fix)

- Debounced autosave, save-on-close
- File-type gating (decline native Google Docs/Sheets/Slides)
- **Fix real bug, now blocking for this scope**: a web save currently resets
  the Drive file's `mimeType` back to `text/plain`, stripping QuietPad's
  custom note tag until Android's own sync re-tags it on next sync. Needs a
  metadata-preserving PATCH (or explicitly resend the original mimeType on
  every content save) — this is the core "save back to the same file"
  round trip this whole app exists for, so it has to actually hold.

## Rendering (port logic only from `web-app`, not its architecture)

- Live markdown rendering: bold/italic/headings/bullets (same minimal rule
  set as Android — no nesting, no extra syntax)
- Tap-to-toggle checklists (`- [ ]` / `- [x]` as a real checkbox)
- Source: `web-app` branch's `src/markdown.js` / per-line `contenteditable`
  approach — port the rendering logic, not the sidebar/store/tabs machinery
  it currently lives inside.

## Diary — included, deliberately unlocked

- Diary entries open and edit exactly like any other note.
- **No first-line lock, no filename lock** (Android enforces both; this web
  app deliberately does not) — explicit "keep it simple" decision.
- **No calendar view** — out of scope entirely for this app.
- Accepted risk, not enforced in code: editing a diary entry's first line
  on the web can break Android's date-based calendar lookup for that entry
  (`Diary.headerDateTimeOf` reads the date from that line). Worth a one-line
  mention in the web app's own help text; no validation/lock code planned.

## Attachments — new build, mirrors Android's existing Drive mechanism

Not a port — even `web-app`'s fuller rebuild never finished attachment
upload (read-only previews only). This is real new work, built to the same
Drive-side shape Android already uses (`DriveSyncManager`/
`NoteRepository.attachFile`), so nothing new is required on the Android app
or in Drive's folder layout:

- **Show**: list attachments linked to the open note, found via the shared
  "Attachments" Drive subfolder + each file's `description` field
  (`"Attached to: <note fileName>"`), cross-checked against the note's own
  `[name](./name)` markdown links so a stale/orphaned link doesn't surface a
  phantom attachment.
- **Detach**: remove the markdown link from the note body only; the Drive
  file itself is untouched.
- **Delete**: trash the underlying Drive file (recoverable in Drive's Trash
  for 30 days, not a hard delete) — a distinct action from Detach, matching
  Android's own separate "Remove" treatment.
- **Add**: upload a new file into the Attachments subfolder, set its
  `description` to this note's file name, insert a markdown link into the
  note body.
- **Rename propagation**: if the note is renamed on the web, re-patch every
  linked attachment's `description` field to match — otherwise a later
  Android-side lookup could lose the association (same class of bug Android
  itself already hit and fixed for its own rename path).

## Cut entirely from this scope

- Notes list / sidebar, full-text search, multi-tab session
- Local-folder-as-library mode (the single local-device open/save above is
  kept; browsing a whole folder as a note library is not)
- Diary month-calendar grid
- Labels (create/assign/filter) — not built on web at all currently, and
  not part of this scope
- Reminders — Android/local-notification-specific, no web equivalent
  planned
- The paid-tier/Play-purchase-gating idea — stays parked, unrelated to this
  scope change

## Open implementation questions (not yet decided, raise before building)

- Exact UI placement for the attachment list/add/detach/delete controls
  within the existing single-file editor layout.
- Whether "Add attachment" on web should offer camera/mic capture (Android
  has both) or file-upload only — a browser's own file input covers both via
  its own file picker (e.g. "Take photo") on mobile, so this may not need
  separate code paths; confirm on a real phone browser before assuming so.
