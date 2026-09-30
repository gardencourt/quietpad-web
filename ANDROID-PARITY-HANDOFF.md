# QuietPad Android → Web: status & feature reference

**Written 2026-09-30, from the `ownote` (Android) repo's Claude Code memory,
to make this repo self-contained for picking the web work back up.** If
you're starting a fresh Claude Code session for the web app, read this file
first — a session rooted here doesn't automatically see anything from the
Android project's memory.

## Do we need a new project? No.

This repo (`gardencourt/quietpad-web`, local `C:\Users\arvin\quietpad-web`)
**is** the web rebuild, and it's well past a blank scaffold. Continue here,
on branch **`web-app`** (not `main` — `main` is what the live site at
quietpad.co.uk actually serves via GitHub Pages/IONOS DNS today, and merging
`web-app` into it before the domain moves to Cloudflare would break the live
site — see "Setup still needed" below). `web-app` has a real, working Preact
+ Vite notes app: sidebar list, search, tabs, Drive **and** local-folder
backends, diary separation. It's paused mid-feature, not abandoned or
stale-designed.

Recommended: open a **new Claude Code session rooted in this folder**
(`C:\Users\arvin\quietpad-web`) for the actual implementation work, rather
than continuing inside the `ownote`-rooted session — that session's memory
belongs to the Android project and won't be visible here.

## Current state of the web app (branch `web-app`)

Preact + Vite (`npm run dev` → `http://localhost:5173/edit/`, already an
authorized origin on the right OAuth client — see below). Landing/privacy/
terms/icons live in `public/` verbatim; only `/edit/` is the built app.

Structure:
- `src/store.js` — signals: notes, tabs, docs, search, autosave, a
  modified-time conflict check, refresh-on-tab-focus.
- `src/session.js` — boot sequence, storage-backend chooser.
- `src/auth.js` — Google Identity Services token client, silent refresh.
- `src/backends/{drive,local,demo}.js` — one shared interface every backend
  implements: `listNotes` / `readNote` / `getModified` / `writeNote` /
  `createNote` / `renameNote` (→ `{id, modified}`) / `trashNote` /
  `setProps` / `attachmentUrl`, plus a `trashedMessage`.
- `src/components.jsx`, `src/app.css` — UI.
- `src/util.js` — diary rules (see below).
- `src/idb.js` — IndexedDB, used to persist the local-folder handle.

**Built and working:**
- Start screen: choose Google Drive or a local folder.
- Sidebar note list + search (including `#tag` search).
- Chrome-style tabs, restored per storage backend.
- Editor with autosave, rename, pin, colour, delete.
- Attachment previews (read-only — no upload/capture yet, see gaps).
- **Drive backend**: uses the Android app's own OAuth Web client (critical —
  see "Key finding" below), lists the whole QuietPad Drive folder including
  the `Attachments` subfolder.
- **Local-folder backend** (File System Access API, Chrome/Edge only): notes
  are top-level `.md`/`.markdown`/`.txt` files in the chosen folder; pin/
  colour live in a `.quietpad.json` sidecar (since a plain text file has
  nowhere else to carry that); delete moves the file to a `.trash/`
  subfolder; the folder handle is kept in IndexedDB and reopened with a
  "Continue with folder" click when the browser re-demands the permission
  prompt (it can't be granted silently on reload); the file name **is** the
  note's id, so renaming remaps id → path.
- **Diary separation**, matching the Android app's rules: `isDiaryNote`,
  `diaryDateFromName`, `isLockedDiaryEntry`, `headerIntact` in `src/util.js`;
  a Notes | Diary switch in the sidebar; "+ Entry" in Diary view; diary tabs
  show only the date; diary file name is read-only and the first line can't
  be edited (attempting it shows a toast and reverts the text).
- Dev-only test modes: `?demo` (in-memory fake notes, no auth) and
  `?demo=opfs` (a real local-folder backend against the browser's own
  sandboxed OPFS storage — this is how rename/pin/colour/delete were
  verified on disk without touching a real folder).

**Known gaps, not yet built (this is the actual to-do list):**
- No markdown rendering — raw text shown, including raw `[name](./file)`
  attachment-link syntax (Android hides/underlines these).
- No tap-to-tick checklists (Android renders `- [ ]`/`- [x]` as ☐/☑ and
  toggles on tap).
- No formatting toolbar (Android has Bold/Italic/Heading/Bullet/Checklist).
- No attachment upload or camera/mic capture — preview-only so far.
- No diary month-calendar grid — Android's Diary screen is a real calendar
  with entry dots; web is currently a plain date-sorted list.
- No labels at all (Android has full Gmail-style labels — see the Android
  feature reference below).
- No reminders.
- Phone-sized layout is untested (built/checked on desktop only).
- `quietpad.co.uk` DNS is still on GitHub Pages/IONOS, not yet moved to
  Cloudflare — **this blocks merging `web-app` to `main`** (see below).
- Sync is deliberately last-write-wins, no conflict UI beyond a
  modified-time check — see "Deliberate differences from Android" below.

## Key finding (2026-09-25) — don't lose this again

`drive.file` scope visibility is **per Google Cloud project**, not global.
The web app must use the **same Cloud project and Web OAuth client as the
Android app** (`ownote`'s project, client id prefix `780542948149-…`) — a
different project's client saw 0 files in the same Drive folder; switching
to the Android project's client (after adding `https://quietpad.co.uk` to
its Authorized JavaScript origins) saw all 33 files correctly. This also
means: Picker API key and any future Drive UI integration registration
belong on project `780542948149`, not a separate one, and Picker itself may
be unnecessary now that the folder can just be listed directly.

## Setup still needed before `web-app` can go live

- **Move `quietpad.co.uk` DNS from GitHub Pages/IONOS to Cloudflare**
  (check IONOS DNS records for any existing email routing first, so that
  isn't broken by the move). A Cloudflare Workers Static Assets preview
  already exists and deploys from this repo:
  `quietpad-web.krispykrepes.workers.dev` — dashboard build settings, no
  `wrangler.jsonc`-driven CI yet. The build command in the Cloudflare
  dashboard may need aligning with what's actually in `wrangler.jsonc`.
- Only **after** the DNS move: merge `web-app` → `main` (merging first would
  replace the live static site with the new app before the domain can
  actually serve it correctly).
- `public/_headers` has a Report-Only CSP — decide whether to enforce it
  before going live.
- OAuth consent screen still needs to go Testing → "In production" for real
  (non-test-list) users to sign in at all.
- Same Cloud Console project as Android throughout (see Key Finding above)
  — do not create a second project for this.

## Deliberate differences from Android (already decided, don't relitigate)

- **No conflict resolution** — Android's three-way sync (push/pull/real
  three-way merge with `-conflict-` copies) was explicitly judged
  disproportionate to rebuild in a second, independent codebase. Web is
  last-write-wins with only a modified-time staleness check.
- **No ads, ever** — validated against a real competitor
  (`texteditor.co`, which does the same Drive-integration pattern but
  behind a full ad-consent wall) as the concrete "what not to be" reference.
- **Free for now.** A paid-web-tier idea exists (gate web access behind
  proof of an Android Play purchase, via a small Cloudflare Worker + D1
  checking the Play Developer API) but is explicitly parked — only revisit
  if the user asks to charge for web, or wants this built.
- **Scope evolved once already**: originally planned as a general-purpose
  "any Drive text file" Notepad-style editor (two entry points: direct site
  visit, and Drive's own "Open with"/"New" menu via a registered Drive UI
  integration). That's superseded — the chosen scope as of 2026-09-25 is a
  **full QuietPad-like notes app** (list, search, tabs, attachments), what
  `web-app` actually is now. The original Drive-UI-integration plumbing
  (registering an Open URL, MIME types, a Marketplace listing) is not
  currently being pursued, though nothing forecloses adding it back later
  as one more entry point into the same app.
- Room-style local persistence has no web equivalent by design — Drive
  **is** the primary backend; the local-folder mode is a genuinely
  different, simpler second option for someone with no Google account, not
  an offline cache of the Drive data.

---

## Full Android feature reference — the target to replicate

Everything below is what the Android app (package `com.arvin.scratchpad`,
branded **QuietPad**, repo `gardencourt/ownote`, currently released as
**v0.999_25**) actually does today. Use this as the spec; it is more
detailed and more current than the original design docs this project
started from.

### Notes — core
- Create (FAB "+"), rename via an explicit **File Name** field (the name
  *is* the identity — no separate title derived from content), edit with
  autosave (debounced), delete with a confirmation dialog (no "Undo" —
  deliberately, deletion always asks first).
- Local storage model (irrelevant to web, included for completeness): Room
  DB for metadata + plain `.md` files on disk.
- Pin/unpin (📌 prefix in the list, pinned-first sort).
- Six-colour background palette for ordinary notes was tried and then
  **removed** — as of 2026-09-25, **ordinary notes have no colour at all**;
  colour is Diary-only (see Diary section). If the web app still has the
  old six-colour notes UI, that's stale and should be dropped too.
- Home list rows: one line (file name + last-edited side by side, not
  stacked — a two-line list got long fast with 20-30+ notes), tiny label
  tags before the file name, ellipsis-truncated.
- "+" opens a **quick-action menu**, not always a blank note: New note /
  Diary / Dictate / Checklist / Audio / Photo / Video / Drawing — each
  jumps straight into that action once the new note opens. (This went
  through a radial "fan" UI experiment and back to a plain icon+text
  dropdown list — plain list is the current, settled design; don't
  reintroduce a radial layout without being asked.)

### Search
- Full-text, relevance-ranked (FTS5 + `bm25()` on the Android side) — not a
  plain substring filter. Matches file name AND body content.
- `#word` typed into the search box shows live tag-autocomplete suggestions
  (only while the query starts with `#`).
- Also matches label names.

### Markdown formatting & rendering
- **Not** a full markdown engine — deliberately minimal, no nesting, no
  other syntax beyond what's listed here.
- `**bold**`, `*italic*` / `_italic_`, `# ` through `###### ` headings,
  `- `/`* ` bullets (rendered as a `•` glyph), `- [ ]`/`- [x]` checklists
  (rendered as a real ☐/☑ glyph, tap to toggle).
- Markers are shown raw only on the line the cursor is currently on;
  every other line renders the styled/hidden-marker version — lets you see
  the syntax while editing that line, without raw `**`/`*` cluttering the
  rest of the note.
- A slim formatting toolbar (Bold / Italic / Heading / Bullet / Numbered /
  Checklist) appears above the keyboard while the note body has focus.
- Table of contents: any `#`–`######` line is a heading; a "Contents" list
  above the note body, indented by level, tap to jump — recomputed once per
  editing session, not live on every keystroke (a live-recompute version
  caused a real bug: the growing TOC box pushed just-typed text out of
  view, which looked like data loss).
- Bare URLs (`https://…`, `http://…`, `www.…`) are auto-detected (Android
  uses `android.text.util.Linkify`) and rendered underlined + tap-to-open —
  no `[text](url)` markdown needed for a plain pasted link.
- Attachment links (`[display name](./actual-filename)`) render as just the
  underlined display name — the file's own duplicate-name syntax collapses
  invisibly rather than showing as two lines of raw markdown.

### Diary
- A diary entry is a regular note with a locked identity: file name
  `Diary yyyy-MM-dd HH-mm.md` and/or a `#Diary` tag on its (non-heading)
  first line. Both the **file name and the first line are locked** —
  neither can be edited once created (the app enforces this; the web app
  should too, per `src/util.js`'s existing `headerIntact`/lock logic).
- Diary entries are **excluded** from the ordinary notes list, search, and
  tab strip everywhere — they only ever appear on the dedicated Diary
  screen.
- Android's Diary screen is a real **month calendar grid** with a dot on
  days that have an entry, tap a day to see/create that day's entry(s), tap
  the month header for a month/year picker, "+ New entry". (Web currently
  has only a flat date-sorted list — this is a real, known gap.)
- Diary has its own colour system, **separate from ordinary notes** (which
  have no colour at all): a device-local default colour in Settings (blue /
  pink / grey / yellow, default blue), softly tinting every diary entry
  that hasn't picked its own colour; an entry's own colour choice (from the
  same four) overrides the default. Tint strength is deliberately subtle
  (15% mix into the background), not a bold colour block.
- Diary entries have an explicit, queryable date (Android: `diaryDate`
  column) resolved in this priority order: **file-name date stamp** (locale
  -independent) → the header line's date (can be ambiguous across device
  languages) → whatever's already stored → last-modified time as a final
  fallback. File name wins over the header — worth matching if the web app
  ever needs to resolve a diary date itself rather than trusting what's in
  Drive's metadata.

### Reminders
- A per-note reminder: date + time-of-day (30-minute steps) + repeat
  (Once / Daily / Weekly / Monthly / Yearly). Fires a local notification
  that deep-links straight into the note. A repeat rule rolls forward from
  its original anchor date/time (so a monthly reminder set on the 31st
  doesn't drift onto shorter months incorrectly).
- Not yet on web at all.

### Labels (Gmail-style — not folders)
- A note (or diary entry) can carry **several** labels. Manage labels
  (create/rename/delete, with per-label note counts) in one place; assign
  from a tick-list picker with an inline "+ New label".
- Each label has: a name, an optional colour (from the same palette notes
  used to have), and a **scope** — Notes-only, Diary-only, or Both — so a
  "Family" label for notes and a differently-scoped "Family" label for
  diary entries can coexist without colliding.
- Browsing: a row of filter chips ("All" + every label) on both Home and
  the Diary screen — **only showing labels actually in use** on that
  screen (a label used only by diary entries doesn't clutter Home's chip
  row, and vice versa) — plus a tiny 3-character abbreviated tag shown
  before the file name on every list row.
- Label names are searchable.
- Not yet on web at all — this is a real, sizeable gap.

### Attachments
- Add via: system file picker, camera capture (photo or video), voice
  memo recording, or a full-screen freehand drawing canvas (5 colours,
  undo, clear) — a drawing or an edited photo always saves as a **new**
  attachment, never overwrites the original (deliberate: sync assumes an
  attachment's bytes never change once created).
- Every attachment gets a visible tile: a real decoded thumbnail for
  images, a generic uppercase-extension badge (PDF, M4A, …) for everything
  else — nothing is attached with zero visual representation.
- Tap a thumbnail or its markdown link to open/view it in-place (images) or
  hand off to another app (`ACTION_VIEW`) for everything else; long-press
  offers Edit (images only) or Remove, with a confirmation before removing.
- A missing local attachment that's still known on Drive shows a distinct
  "Missing" tile; tapping it re-downloads it from Drive on demand.
- Web currently only previews attachments read-only — no upload, no
  capture, and presumably no drawing canvas equivalent.

### Sharing
- The plain Android share sheet (`ACTION_SEND`), not a live/synced share —
  a one-time copy of the note's text (plus any attachments, as real
  media/files via `ACTION_SEND`/`ACTION_SEND_MULTIPLE` so e.g. WhatsApp
  treats a shared photo as a real photo, not a generic file). This was
  chosen deliberately over Drive-native viewer-sharing, because a
  recipient with no Google account at all shouldn't have to create one
  just to receive a note.
- Share-**into** the app: the OS share sheet's "QuietPad" target accepts
  text, images, or video from another app and creates a new note from it
  (named from the share's subject/title, or the source URL's site name, or
  the first line of shared text).
- Neither direction is meaningful for a pure web app in the same way (no
  OS-level share sheet to plug into), but worth knowing the Android
  behavior if any "export"/"share" affordance is ever added to web.

### Multi-note tabs
- Chrome-style: every note opened joins a tab strip and stays open across
  Back navigation; capped at 6 tabs (oldest evicted); a collapsed
  (non-active) tab shows a short 3-character label, expanding to a
  disambiguated form only if two collide. Diary tabs show only the date.
  "Close all" clears the strip. Web's `web-app` branch already has a
  Chrome-style tab strip — check it matches this behavior (cap, eviction,
  short-label collision handling) rather than assuming parity.

### Settings / accounts
- Up to 3 connected Google accounts, quick-switch, active account's
  (shortened, common-suffix-dropped) email shown in the header.
- A "Sync" action, manual-first: Android deliberately moved away from
  frequent automatic sync (background timers/debounces) after repeated
  false-conflict reports traced to sync-vs-edit races; sync now only runs
  on an explicit tap, on app-background, and once on-resume-from-background
  ("sync on open"). **Worth remembering if the web app's own
  auto-save/auto-sync cadence ever produces spurious conflicts** — Android
  hit this exact class of bug multiple times before simplifying the
  triggers, not the conflict logic itself.
- A "Diary colour" default picker (see Diary section).
- An in-app Help screen (collapsible sections) and About screen.

### Trial & paywall
- 14-day free trial (**currently 60 days**, a deliberate temporary
  extension for the current Play closed-testing round — must revert to 14
  before any Production Play release; not yet done as of v0.999_25), then a
  one-time Google Play Billing purchase unlocks new-note creation forever
  (existing notes always stay fully usable regardless of trial state).
  **This model is Android/Play-specific and has no obvious web equivalent**
  — the web app is simply free for now (see "Deliberate differences"
  above); don't try to replicate the trial timer or Play Billing on web
  without a specific reason to.

### Branding / visual conventions worth matching
- Brand colours: a blue/gold pairing (blue app-bar/background, gold
  accents on primary actions), explicitly **not** using Android's dynamic
  Material-You wallpaper-derived colour — a QuietPad accent should look the
  same regardless of the user's own theme.
- A black-pill/gold-text (or gold-icon) button style used consistently for
  every secondary action row (Settings/Help, Sync, Attach/Record/Calendar,
  Diary/hamburger, etc.) — one consistent control family, not a mix of
  plain text buttons and coloured pills.
- The editor page has a "ruled paper" look (faint horizontal rules under
  each line), matching the app icon's own legal-pad-with-blue-lines design.
- Most recent Android UI change (2026-09-29/30): the Home header was
  redesigned into one continuous blue bar — wordmark + italic tagline
  ("Your Notes. Your Diary. Your Drive.") in the top strip, then account
  email / Sync (icon-only, spins while syncing) / Search / Diary (icon-
  only) / hamburger menu all in one row directly below it, all sized to
  the same height. Purely a phone-app layout detail — not something to
  port literally to a desktop-first web layout, but the "one consistent
  control family, one clear brand strip" *intent* behind it is worth
  keeping in mind for any web header redesign.

---

## Where things live

- Android app: `gardencourt/ownote` (local `C:\Users\arvin\ownote`),
  branch `main`, currently at `v0.999_25`.
- This web app: `gardencourt/quietpad-web` (local
  `C:\Users\arvin\quietpad-web`), branch `web-app` has all the real
  progress; `main` is the live (older, static-editor) site.
- Both share one Google Cloud Console project (`780542948149-…`) — see
  "Key finding" above. Do not create a second project for web.
