# QuietPad Web Editor

A plain text/markdown editor for files in Google Drive. No backend of ours —
every Drive call happens directly from the browser using the signed-in
user's own OAuth token, the same architecture as the QuietPad Android app
(see the `ownote` repo). Static site, no build step, no framework.

Design/planning history for this project lives in the `ownote` repo's
Claude Code memory (not duplicated here) — the short version: general-purpose
text editor (any Drive file, not just QuietPad's own notes), reached two
ways — a direct visit to the site (sign in, then a Notepad-style "Open" via
Google Picker, or "New") — and Google Drive's own "Open with" / "New" menu
entries, via a registered Drive UI integration. No ads, ever.

## Structure

- `index.html` / `style.css` — landing page (QuietPad branding + links to
  other products; **the product cards' links are placeholders, replace
  before going live**).
- `edit/` — the actual editor. `index.html` + `editor.css` + `editor.js` +
  `config.js` (credentials — see below).
- `privacy.html` / `terms.html` — drafts, accurate to how the app works
  today but **not legal-reviewed**. Needed for OAuth verification and any
  Marketplace listing; Google checks that these match what the app's
  consent screen and requested scopes actually do.
- `CNAME` — GitHub Pages custom domain file, already set to
  `quietpad.co.uk`.

## Google Cloud Console setup (manual — not done yet)

Reuses the **same Cloud Console project as the Android app** (`ownote`'s
README has the original setup) — not a new project. That project already
has a Web OAuth client (currently configured with no redirect URIs, since
it's only used today for Android's Credential Manager identity flow).

1. **APIs & Services → Library** → enable the **Google Picker API**
   (alongside the Drive API, already enabled for the Android app).
2. **APIs & Services → Credentials** → open the existing **Web application**
   OAuth client → add:
   - **Authorized JavaScript origins**: `https://quietpad.co.uk`
   - **Authorized redirect URIs**: not needed for the token-client flow this
     uses (`google.accounts.oauth2.initTokenClient`), but add
     `https://quietpad.co.uk/edit/` too if a redirect-based flow ever
     replaces it.
   - Copy the Client ID into `edit/config.js` → `CLIENT_ID`.
3. **APIs & Services → Credentials → Create Credentials → API key** → a new
   key, restricted to the **Picker API** and to `quietpad.co.uk`. Copy it
   into `edit/config.js` → `PICKER_API_KEY`.
4. **Domain verification** (Google Search Console) — verify ownership of
   `quietpad.co.uk`. Required before the OAuth consent screen can reference
   this domain, and separately before the Drive UI integration (next
   section) is visible to anyone beyond your own authorized account.
5. **OAuth consent screen → Audience** → move from Testing to **In
   production** once ready for real, non-test users to sign in. This
   triggers Google's verification review (real turnaround time — days to
   weeks) — needs the privacy policy URL (`https://quietpad.co.uk/privacy.html`),
   an accurate app description, and possibly a short demo. Still the
   ordinary `drive.file` review tier, not the costly restricted-scope
   security assessment, as long as nothing here asks for a broader scope.

## Drive UI integration (manual — not done yet)

This is what makes "right-click a file in Drive → Open with QuietPad" and
"Drive's own + New menu → QuietPad" actually appear for users.

1. **APIs & Services → Drive API → Drive UI integration** tab:
   - **Open URL**: `https://quietpad.co.uk/edit/`
   - **Icon**: QuietPad icon (reuse the Android app's icon asset).
   - **Supported MIME types**: broad, general-purpose on purpose — e.g.
     `text/plain`, `text/markdown` — **not** the narrow custom
     `application/vnd.quietpad.note+markdown` type the Android app uses to
     scope its own "Open with QuietPad" to just its own notes. Those are two
     deliberately separate mechanisms; don't conflate them.
   - **Enable the "New" button integration** — decided on, unlike the
     Android-side QuietPad-notes-only integration which explicitly leaves
     this off. `editor.js` already handles the resulting `action: "create"`
     hand-off (see `startNewFile`).
2. **Google Workspace Marketplace listing** — needed for the integration to
   be usable by anyone, not just your own authorized test accounts:
   description, screenshots, support contact, links to the privacy
   policy/terms pages above, and its own review process (separate from, but
   related to, the OAuth verification above).

## Deploying

Static site — push to `main`, enable GitHub Pages (Settings → Pages →
Deploy from branch → `main` → `/ (root)`), point `quietpad.co.uk`'s DNS at
GitHub Pages per
[GitHub's own custom-domain docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site).
The `CNAME` file here already has the domain name Pages needs.

## What's built vs. not

Built: landing page, sign-in, Picker-based Open, New-file (deferred
creation — nothing written to Drive until the first real save), the Drive
UI integration hand-off parsing (`?state=`) for both "open" and "create"
actions, debounced autosave, file-type gating (declines native Google
Docs/Sheets/Slides with a clear message — this is a plain text editor, not
a format-converting one).

Not built: no conflict handling (last-write-wins, deliberately — see the
planning notes), no rename-collision handling on create (Drive allows
duplicate file names; unlike the Android app's `uniqueFileFor`, this
doesn't try to dedupe), no code-editor features (syntax highlighting, line
numbers) — deliberately out of scope, this is a plain text editor.
