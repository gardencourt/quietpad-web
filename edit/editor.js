// QuietPad web editor — companion to the Android app, restricted scope (v1.1).
// No backend of ours — every Drive call here goes straight from this page to
// Google's own API using the signed-in user's own OAuth token, drive.file
// scope only (see config.js). This page can only EDIT a note that already
// exists in that account's QuietPad folder: no create, delete, rename, move,
// copy, or upload. The only Drive write call anywhere below is
// updateContent() — a files.update PATCH of content only.

const APP_FOLDER_NAME = "QuietPad";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const AUTOSAVE_DEBOUNCE_MS = 1000;

// Non-text guard (safety, A.4): refuse to open anything that isn't plain
// text. An allowlist, not a blocklist — Android's own notes carry a custom
// mimeType (see NOTE_MIME_TYPE) rather than a plain text/* one, so that has
// to be named explicitly too, not just "starts with text/".
const NOTE_MIME_TYPE = "application/vnd.quietpad.note+markdown";
const ALLOWED_MIME_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown", NOTE_MIME_TYPE]);

// A live, always-visible event log (see index.html's #debug-log) — hidden
// unless ?debug=1 is in the URL, since console.log alone is unreachable when
// debugging a report from someone's phone.
const DEBUG_MODE = new URLSearchParams(window.location.search).has("debug");
function debugLog(msg) {
  console.log(msg);
  if (!DEBUG_MODE) return;
  const el = document.getElementById("debug-log");
  if (el) {
    el.hidden = false;
    const t = new Date().toISOString().slice(11, 23);
    el.textContent += `[${t}] ${msg}\n`;
    el.scrollTop = el.scrollHeight;
  }
}

/** Google's own format for a Drive UI integration "Open with" hand-off (see
 *  the Cloud Console "Drive UI integration" tab). Only ever "open" here —
 *  the "create" action (Drive's "New" button) has no meaning in an editor
 *  that can't create files, so it's never honoured even if Drive sends it. */
function parseDriveState() {
  const raw = new URLSearchParams(window.location.search).get("state");
  if (!raw) return null;
  try {
    const state = JSON.parse(raw);
    return state.action === "open" && state.ids && state.ids[0] ? state.ids[0] : null;
  } catch (e) {
    debugLog("parseDriveState: unparseable state param: " + raw);
    return null;
  }
}

/** The Android app's hamburger menu ("Open Notes on quietpad.co.uk") links
 *  here as #login_hint=<email> — a URL *fragment*, deliberately, never a
 *  query string: a fragment is never sent in the HTTP request itself, so
 *  the email never reaches a server log, including GitHub Pages' own. */
function parseLoginHint() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return hash.get("login_hint") || null;
}

function updateUrlState(fileId) {
  const state = encodeURIComponent(JSON.stringify({ action: "open", ids: [fileId] }));
  history.replaceState(null, "", `${window.location.pathname}?state=${state}`);
  sessionStorage.setItem(REMEMBERED_FILE_KEY, fileId);
}

// Survives a reload (back/forward, a stray refresh, a discarded-and-restored
// tab) the same way the broader editor this replaces relied on it for.
const REMEMBERED_FILE_KEY = "quietpad-last-open-file-id";

const screens = {
  start: document.getElementById("start-screen"),
  editor: document.getElementById("editor-screen"),
  error: document.getElementById("error-screen")
};

function showScreen(name) {
  debugLog("showScreen: " + name);
  for (const key in screens) screens[key].hidden = key !== name;
}

function showError(message) {
  document.getElementById("error-message").textContent = message;
  showScreen("error");
}

// --- Auth -------------------------------------------------------------

let accessToken = null;
let tokenClient = null;
const loginHintEmail = parseLoginHint();

function initAuthWhenReady() {
  if (typeof google === "undefined" || !google.accounts) {
    setTimeout(initAuthWhenReady, 100);
    return;
  }
  debugLog("google.accounts ready, initializing token client, hint=" + loginHintEmail);
  const config = {
    client_id: QUIETPAD_CONFIG.CLIENT_ID,
    scope: QUIETPAD_CONFIG.SCOPE,
    callback: (response) => {
      if (response.error) {
        debugLog("Auth failed: " + JSON.stringify(response));
        return;
      }
      debugLog("Auth succeeded, got access token");
      accessToken = response.access_token;
      onSignedIn();
    }
  };
  // Pre-selects the app's own active account in the Google account chooser —
  // skips an otherwise-pointless extra click when we already know exactly
  // which account this is (see parseLoginHint above).
  if (loginHintEmail) config.hint = loginHintEmail;
  tokenClient = google.accounts.oauth2.initTokenClient(config);

  const driveFileId = parseDriveState();
  const rememberedFileId = sessionStorage.getItem(REMEMBERED_FILE_KEY);
  if (driveFileId || rememberedFileId || loginHintEmail) {
    debugLog("Known account or file on load — trying a silent sign-in first");
    tokenClient.requestAccessToken({ prompt: "" });
  } else {
    showScreen("start");
  }
}

function onSignedIn() {
  document.getElementById("sign-in-button").hidden = true;
  const driveFileId = parseDriveState();
  const rememberedFileId = sessionStorage.getItem(REMEMBERED_FILE_KEY);
  if (driveFileId) {
    openFile(driveFileId);
  } else if (rememberedFileId) {
    openFile(rememberedFileId);
  } else {
    // Nothing specific to resume — go straight to picking a note rather
    // than making a signed-in visitor click twice.
    openFromDrive();
  }
}

document.getElementById("sign-in-button").addEventListener("click", () => {
  tokenClient.requestAccessToken({ prompt: "consent" });
});

document.getElementById("sign-out-button").addEventListener("click", signOut);

function signOut() {
  debugLog("Sign out clicked");
  // NEVER call google.accounts.oauth2.revoke() here (real, serious bug,
  // confirmed live): Google's revoke endpoint doesn't revoke just the one
  // token it's given -- it revokes the ENTIRE grant for that (account,
  // OAuth client) pair, every token anyone ever got from it. This editor
  // deliberately shares the same OAuth client as the Android app (so
  // drive.file visibility lines up, see config.js), so revoking here was
  // invalidating the Android app's own refresh token too, on every device
  // signed into that account -- breaking its sync with "Token has been
  // expired or revoked," confirmed via the app's own logcat. "Sign out" on
  // a single browser tab must only forget this tab's own session, nothing
  // account-wide.
  accessToken = null;
  currentFileId = null;
  // A different account may sign in next — never carry over the previous
  // account's cached folder ID.
  quietPadFolderId = null;
  quietPadFolderIdResolved = false;
  sessionStorage.removeItem(REMEMBERED_FILE_KEY);
  history.replaceState(null, "", window.location.pathname);
  document.getElementById("sign-in-button").hidden = false;
  document.getElementById("open-drive-button").hidden = true;
  showScreen("start");
}

// --- Finding the QuietPad folder (read-only — never created here) -------

// A.2/A.3: this editor only ever works inside the QuietPad folder, and only
// ever reads Drive to find it — files.create (what Android's own
// findOrCreateAppFolder does for the *missing* case) is deliberately not
// mirrored here, since this editor has no "create" call at all.
let quietPadFolderId = null;
let quietPadFolderIdResolved = false;

async function findAppFolderId() {
  if (quietPadFolderIdResolved) return quietPadFolderId;
  const q = encodeURIComponent(`name = '${APP_FOLDER_NAME}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`);
  const result = await driveFetch(`/drive/v3/files?q=${q}&orderBy=createdTime&fields=files(id)`);
  quietPadFolderId = result.files && result.files.length > 0 ? result.files[0].id : null;
  quietPadFolderIdResolved = true;
  debugLog("findAppFolderId: " + quietPadFolderId);
  return quietPadFolderId;
}

// --- Picker (restricted to the QuietPad folder + text/markdown files) ---

let pickerLoaded = false;

function ensurePickerLoaded(onReady) {
  if (pickerLoaded) return onReady();
  gapi.load("picker", () => {
    pickerLoaded = true;
    onReady();
  });
}

async function openFromDrive() {
  debugLog("openFromDrive, signed in=" + Boolean(accessToken));
  if (!accessToken) {
    tokenClient.requestAccessToken({ prompt: "consent" });
    return;
  }
  const folderId = await findAppFolderId().catch((e) => {
    debugLog("findAppFolderId failed: " + (e && e.message ? e.message : e));
    return null;
  });
  if (!folderId) {
    showError("No QuietPad folder found in this account's Google Drive yet — sync a note from the QuietPad app first.");
    return;
  }
  document.getElementById("open-drive-button").hidden = false;
  ensurePickerLoaded(() => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMode(google.picker.DocsViewMode.LIST)
      .setParent(folderId)
      .setIncludeFolders(false)
      // A.2: restricted to plain text/markdown — Android's own notes carry
      // the custom NOTE_MIME_TYPE, which Picker's mimeTypes filter also
      // accepts as a plain CSV entry.
      .setMimeTypes([...ALLOWED_MIME_TYPES].join(","));
    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(accessToken)
      .setDeveloperKey(QUIETPAD_CONFIG.PICKER_API_KEY)
      .setAppId(QUIETPAD_CONFIG.CLIENT_ID.split("-")[0])
      .addView(view)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          openFile(data.docs[0].id);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

document.getElementById("open-drive-button").addEventListener("click", openFromDrive);

// --- Loading a file -------------------------------------------------------

async function openFile(fileId) {
  debugLog("openFile called with fileId=" + fileId);
  try {
    const meta = await driveFetch(`/drive/v3/files/${fileId}?fields=id,name,mimeType,headRevisionId,parents,appProperties`);
    debugLog("Metadata response: " + JSON.stringify(meta));

    // A.2: verify the file's parent really is the QuietPad folder, even for
    // a file reached via Drive's own "Open with" hand-off (parseDriveState)
    // — never trust the caller, always re-check server-side.
    const folderId = await findAppFolderId().catch(() => null);
    if (!folderId || !meta.parents || !meta.parents.includes(folderId)) {
      showError(`"${meta.name}" isn't in your QuietPad Drive folder — refusing to open it here.`);
      return;
    }

    // A.4: non-text guard — refuse anything that isn't plain text, by
    // allowlist rather than by excluding known-bad types.
    if (!ALLOWED_MIME_TYPES.has(meta.mimeType)) {
      showError(`"${meta.name}" isn't a plain text or Markdown file — QuietPad can only edit those here.`);
      return;
    }

    const contentResponse = await driveFetch(`/drive/v3/files/${fileId}?alt=media`, { raw: true });
    const text = await contentResponse.text();
    debugLog(`Content fetched, ${text.length} chars`);

    // A.4: diary entries are read-only here. Android itself treats a diary
    // entry as editable but with its date header line (and file name)
    // locked, to protect Diary.headerDateTimeOf's date-based lookup for
    // that entry — reproducing that same *partial* lock inside a single
    // plain <textarea> isn't a clean fit for "keep the page small and
    // plain" (A.5), so this editor takes the conservative option instead:
    // view the whole entry, but don't let the web side edit it at all.
    const isDiary = Boolean(meta.appProperties && meta.appProperties.diaryDate);

    loadEditor(meta, text, isDiary);
    updateUrlState(fileId);
  } catch (e) {
    debugLog("openFile failed: " + (e && e.message ? e.message : e));
    showError(`Couldn't load this file from Drive.\n\n${e && e.message ? e.message : e}`);
  }
}

// --- Editor ---------------------------------------------------------------

let currentFileId = null;
let currentMimeType = null;
// headRevisionId, not modifiedTime: Drive bumps modifiedTime on ANY
// metadata patch, including the appProperties-only writes Android's own
// sync makes constantly (pin/color/labels/archive) — comparing modifiedTime
// here produced false "changed elsewhere" conflicts on a note nobody had
// actually edited (real report). headRevisionId only changes when the
// file's content itself gets a new revision, which is exactly what this
// check needs to care about.
let openedHeadRevisionId = null;
// The textarea's own .value getter normalizes every line break to "\n"
// regardless of the source's actual bytes (an HTML spec quirk) — so a file
// that uses CRLF has to have that restored right before every PATCH, or an
// edit would silently rewrite every line ending in the file (A.4: "preserve
// … line endings"). savedContentCanonical is always in \n form, to compare
// cleanly against the (always-\n) textarea value.
let savedContentCanonical = "";
let originalUsesCRLF = false;
let saveTimer = null;
let conflicted = false;
// Real report: typing continuously (autosaving every ~1s on each pause)
// produced a false conflict even with the headRevisionId fix above. Cause:
// hasRemoteChange() does a files.get read right before every save,
// including ones that land a second or two after OUR OWN previous save —
// and Drive doesn't guarantee a read immediately after a write reflects
// that write yet. That race compared against a headRevisionId that hadn't
// caught up to what we ourselves had just written, not anyone else's edit.
// Skipping the remote check for a short window after our own last
// successful write closes this off; a genuinely external change is never
// going to land in that same ~8s window in practice, and the very next
// save after it re-enables the real check.
let lastLocalWriteAt = 0;
const SKIP_CONFLICT_CHECK_WITHIN_MS = 8000;

const filenameInput = document.getElementById("filename-input");
const contentArea = document.getElementById("content-area");
const saveStatus = document.getElementById("save-status");
const diaryBanner = document.getElementById("diary-banner");
const conflictBanner = document.getElementById("conflict-banner");

function loadEditor(meta, text, isDiary) {
  currentFileId = meta.id;
  currentMimeType = meta.mimeType;
  openedHeadRevisionId = meta.headRevisionId;
  originalUsesCRLF = text.includes("\r\n");
  savedContentCanonical = normalizeToLF(text);
  conflicted = false;
  conflictBanner.hidden = true;
  lastLocalWriteAt = 0;

  filenameInput.value = meta.name;
  contentArea.value = savedContentCanonical;
  contentArea.readOnly = isDiary;
  diaryBanner.hidden = !isDiary;
  setSaveStatus(isDiary ? "Read-only" : "Saved");
  showScreen("editor");
  if (!isDiary) contentArea.focus();
}

function normalizeToLF(text) {
  return text.replace(/\r\n|\r/g, "\n");
}

function setSaveStatus(text, isError) {
  saveStatus.textContent = text;
  saveStatus.classList.toggle("error", Boolean(isError));
}

function scheduleAutosave() {
  if (conflicted) return;
  clearTimeout(saveTimer);
  setSaveStatus("Saving…");
  saveTimer = setTimeout(save, AUTOSAVE_DEBOUNCE_MS);
}

contentArea.addEventListener("input", scheduleAutosave);

window.addEventListener("beforeunload", () => {
  // Never force a save through an unresolved conflict on the way out —
  // that would be exactly the silent overwrite the conflict check exists
  // to prevent.
  if (saveTimer && !conflicted) { clearTimeout(saveTimer); save(); }
});

/** A.4: before writing, check the file's remote headRevisionId against what
 *  it was when opened. A plain read call (files.get, not a write), run once
 *  right before an actual save rather than on every keystroke. */
async function hasRemoteChange() {
  if (Date.now() - lastLocalWriteAt < SKIP_CONFLICT_CHECK_WITHIN_MS) return false;
  const meta = await driveFetch(`/drive/v3/files/${currentFileId}?fields=headRevisionId`);
  return meta.headRevisionId !== openedHeadRevisionId;
}

async function save(skipConflictCheck) {
  if (!currentFileId || contentArea.readOnly) return;
  const content = contentArea.value; // always \n-normalized by the browser
  if (content === savedContentCanonical) {
    setSaveStatus("Saved");
    return;
  }
  try {
    if (!skipConflictCheck && await hasRemoteChange()) {
      debugLog("Remote change detected before save — holding, not overwriting");
      conflicted = true;
      conflictBanner.hidden = false;
      setSaveStatus("Not saved — changed elsewhere", true);
      return;
    }
    const upload = originalUsesCRLF ? content.replace(/\n/g, "\r\n") : content;
    const meta = await updateContent(currentFileId, upload, currentMimeType);
    savedContentCanonical = content;
    openedHeadRevisionId = meta.headRevisionId;
    lastLocalWriteAt = Date.now();
    setSaveStatus("Saved");
  } catch (e) {
    debugLog("save failed: " + (e && e.message ? e.message : e));
    setSaveStatus("Couldn't save — check your connection", true);
  }
}

document.getElementById("conflict-reload-button").addEventListener("click", () => {
  conflicted = false;
  conflictBanner.hidden = true;
  openFile(currentFileId);
});

document.getElementById("conflict-save-anyway-button").addEventListener("click", () => {
  conflicted = false;
  conflictBanner.hidden = true;
  save(/* skipConflictCheck */ true);
});

// Real request: this used to be a plain <a href="../"> that left the app
// for the marketing homepage — not what a "back" control should do from
// inside a single-note editor. Goes back to picking a different note
// instead, flushing any pending edit first (awaited, not fire-and-forget,
// so currentFileId below can't go null out from under an in-flight save).
document.getElementById("back-button").addEventListener("click", async () => {
  if (saveTimer && !conflicted && !contentArea.readOnly) {
    clearTimeout(saveTimer);
    await save();
  }
  currentFileId = null;
  conflicted = false;
  conflictBanner.hidden = true;
  sessionStorage.removeItem(REMEMBERED_FILE_KEY);
  history.replaceState(null, "", window.location.pathname);
  openFromDrive();
});

// Ctrl/Cmd+S: flush an existing autosave immediately, skipping the debounce.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
  if (screens.editor.hidden) return;
  e.preventDefault();
  if (currentFileId) { clearTimeout(saveTimer); save(); }
});

// --- Drive REST calls -------------------------------------------------

async function driveFetch(path, opts = {}) {
  const response = await fetch(`https://www.googleapis.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`Drive API ${response.status}${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`);
  }
  return opts.raw ? response : response.json();
}

// The one and only Drive *write* call in this entire file (A.3). Drive
// takes a media upload's Content-Type as the file's new mimeType, so this
// must resend the file's existing one — a hardcoded text/plain would
// silently strip Android's custom NOTE_MIME_TYPE tag (and with it the "Open
// with QuietPad" association) on every web save. fields=headRevisionId so
// the conflict check above has a fresh baseline to compare against next
// time, with no extra read call.
async function updateContent(fileId, content, mimeType) {
  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=headRevisionId`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": mimeType || "text/plain"
      },
      body: content
    }
  );
  if (!response.ok) throw new Error(`Drive API ${response.status}`);
  return response.json();
}

// Safety net: any uncaught error anywhere on this page surfaces on the error
// screen instead of leaving a confusing half-loaded UI with no console
// access to explain it (e.g. on a phone).
window.addEventListener("error", (e) => {
  debugLog("window error: " + e.message);
  showError(`Unexpected error: ${e.message}`);
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  const msg = reason && reason.message ? reason.message : reason;
  debugLog("unhandledrejection: " + msg);
  showError(`Unexpected error: ${msg}`);
});

debugLog("editor.js loaded, URL=" + window.location.href);
initAuthWhenReady();
