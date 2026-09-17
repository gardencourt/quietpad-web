// QuietPad web editor. No backend of ours — every Drive call here goes
// straight from this page to Google's own API using the signed-in user's own
// OAuth token, the same "no server of ours" shape as the Android app. See
// config.js for the Client ID / API key this needs filled in before sign-in
// will actually work.

const AUTOSAVE_DEBOUNCE_MS = 1000;
const APP_FOLDER_NAME = "QuietPad";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

// Local-device open/save uses the File System Access API (real read/write
// file handles, so "Save" overwrites the original file in place). Chromium
// only as of writing -- Firefox/Safari fall back to a plain <input
// type=file> for opening and a one-shot download for saving, see
// openFromDevice / setTargetDevice below.
const FS_ACCESS_SUPPORTED = "showOpenFilePicker" in window;
const TEXT_FILE_TYPES = [{
  description: "Text files",
  accept: { "text/plain": [".txt", ".md", ".markdown", ".text"] }
}];

// A live, always-visible event log (see index.html's #debug-log, deliberately
// outside the .screen divs so it survives regardless of which screen is
// showing). Hidden unless ?debug=1 is in the URL -- console.log alone is
// unreachable when debugging a report from someone's phone, so this is kept
// intentionally for that case rather than removed.
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

/** Google's own format for a Drive UI integration hand-off (the "Open with"
 *  and "New" entries) — see the Cloud Console "Drive UI integration" tab.
 *  action is "open" (existing file, ids present) or "create" (the "New"
 *  button, folderId present instead). Absent entirely on a plain visit —
 *  that's the Notepad-style "just launched the app" case. */
function parseDriveState() {
  const raw = new URLSearchParams(window.location.search).get("state");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    debugLog("parseDriveState: unparseable state param: " + raw);
    return null;
  }
}

/** Keeps the URL in sync with the file currently open, in the same
 *  ?state= shape Drive's own hand-off uses (see parseDriveState) -- mainly
 *  so the URL is meaningful if copied/bookmarked. This alone doesn't
 *  survive browser back navigation, though: back doesn't reload *this*
 *  document with its (replaced) URL, it navigates to whatever history
 *  entry came before this whole /edit/ visit -- so REMEMBERED_FILE_KEY in
 *  sessionStorage below is the mechanism that actually recovers the open
 *  file, independent of history/URL mechanics entirely. */
function updateUrlState(fileId) {
  const state = encodeURIComponent(JSON.stringify({ action: "open", ids: [fileId] }));
  history.replaceState(null, "", `${window.location.pathname}?state=${state}`);
  sessionStorage.setItem(REMEMBERED_FILE_KEY, fileId);
}

// Real report: browser back navigation (after opening a file) landed back
// on a blank sign-in screen with no memory of which file had been open --
// likely because the beforeunload listener below opts this page out of
// bfcache in most browsers, so back forces a full fresh reload rather than
// an instant in-memory restore. sessionStorage survives that reload (unlike
// our plain JS variables), scoped to just this tab, so it's what actually
// lets a reload -- from back/forward, a stray refresh, or a discarded and
// restored tab -- reopen the same file instead of losing it.
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

// Set right before requesting a token from a *contextual* sign-in (the user
// clicked "Open from Google Drive" or chose "Google Drive" in the save-target
// dialog while signed out) — tells the token callback what to resume once
// auth succeeds, instead of running the startup-only onSignedIn() logic.
let pendingAuthAction = null;

/** Fires once Google's own identity script has actually loaded — the plain
 *  <script defer> tag alone doesn't guarantee `google` exists yet by the
 *  time this file starts running. */
function initAuthWhenReady() {
  if (typeof google === "undefined" || !google.accounts) {
    setTimeout(initAuthWhenReady, 100);
    return;
  }
  debugLog("google.accounts ready, initializing token client");
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: QUIETPAD_CONFIG.CLIENT_ID,
    scope: QUIETPAD_CONFIG.SCOPE,
    callback: (response) => {
      if (response.error) {
        debugLog("Auth failed: " + JSON.stringify(response));
        pendingAuthAction = null;
        return;
      }
      debugLog("Auth succeeded, got access token");
      accessToken = response.access_token;
      const action = pendingAuthAction;
      pendingAuthAction = null;
      if (action === "open-drive") {
        openPicker();
      } else if (action === "save-drive") {
        setTarget({ type: "drive", fileId: null, folderId: null });
        save();
      } else {
        onSignedIn();
      }
    }
  });
  // A Drive hand-off (or a remembered previously-open Drive file) already
  // implies the user is a real Google account holder — try a silent
  // (no-prompt) token first so reopening doesn't force a visible sign-in
  // click when a session already exists. A plain visit with neither gets no
  // sign-in prompt at all: the start screen is a usable, account-free text
  // editor on its own (New file / Open from this device), and Drive is only
  // ever one contextual click away, never forced up front.
  const state = parseDriveState();
  if (state || sessionStorage.getItem(REMEMBERED_FILE_KEY)) {
    debugLog("Drive state or remembered file present on load: " + JSON.stringify(state));
    tokenClient.requestAccessToken({ prompt: "" });
  } else {
    debugLog("No Drive state on load (plain visit) — showing start screen");
    showScreen("start");
  }
}

function onSignedIn() {
  const state = parseDriveState();
  debugLog("onSignedIn, state=" + JSON.stringify(state));
  const rememberedFileId = sessionStorage.getItem(REMEMBERED_FILE_KEY);
  if (state && state.action === "open" && state.ids && state.ids[0]) {
    openFile(state.ids[0]);
  } else if (state && state.action === "create") {
    startNewFile(state.folderId || null);
  } else if (rememberedFileId) {
    openFile(rememberedFileId);
  } else {
    showScreen("start");
  }
}

function openFromDrive() {
  debugLog("Open from Google Drive clicked, signed in=" + Boolean(accessToken));
  if (!accessToken) {
    pendingAuthAction = "open-drive";
    tokenClient.requestAccessToken({ prompt: "consent" });
    return;
  }
  openPicker();
}

// --- Picker (Notepad-style "File > Open") ------------------------------

let pickerLoaded = false;

function ensurePickerLoaded(onReady) {
  if (pickerLoaded) return onReady();
  debugLog("Loading Picker library");
  gapi.load("picker", () => {
    pickerLoaded = true;
    debugLog("Picker library loaded");
    onReady();
  });
}

function openPicker() {
  debugLog("openPicker called");
  ensurePickerLoaded(() => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMode(google.picker.DocsViewMode.LIST);
    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(accessToken)
      .setDeveloperKey(QUIETPAD_CONFIG.PICKER_API_KEY)
      // Required for drive.file-scoped Picker use, per Google's own docs --
      // the Cloud project number, which is also the numeric prefix on the
      // OAuth Client ID itself (before the first "-"), so it's derived here
      // rather than duplicated as a separate config value. Without this,
      // Picker can fail outright ("There was an error!") or return a file ID
      // whose *later* requests 404, even though the pick itself looked fine.
      .setAppId(QUIETPAD_CONFIG.CLIENT_ID.split("-")[0])
      .addView(view)
      .setCallback((data) => {
        debugLog("Picker callback fired: " + JSON.stringify(data));
        if (data.action === google.picker.Action.PICKED) {
          openFile(data.docs[0].id);
        }
      })
      .build();
    debugLog("Showing Picker");
    picker.setVisible(true);
  });
}

document.getElementById("open-drive-button").addEventListener("click", openFromDrive);
document.getElementById("new-button").addEventListener("click", startBlankDraft);
document.getElementById("open-device-button").addEventListener("click", openFromDevice);

// --- Local device files (open/save anywhere on disk, no Google account) ---

const deviceFileInput = document.getElementById("device-file-input");

async function openFromDevice() {
  debugLog("Open from this device clicked, FS_ACCESS_SUPPORTED=" + FS_ACCESS_SUPPORTED);
  if (!FS_ACCESS_SUPPORTED) {
    deviceFileInput.click();
    return;
  }
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({ types: TEXT_FILE_TYPES });
  } catch (e) {
    if (e.name !== "AbortError") debugLog("showOpenFilePicker failed: " + e.message);
    return;
  }
  const file = await handle.getFile();
  const text = await file.text();
  debugLog(`Opened local file ${file.name}, ${text.length} chars`);
  loadEditor({ type: "device", handle }, file.name, text);
}

// Fallback for browsers without the File System Access API: can read a
// picked file via FileReader, but there's no writable handle to save back
// to, so the loaded file has no target yet (see save()'s device fallback).
deviceFileInput.addEventListener("change", async () => {
  const file = deviceFileInput.files[0];
  deviceFileInput.value = "";
  if (!file) return;
  const text = await file.text();
  debugLog(`Opened local file (fallback input) ${file.name}, ${text.length} chars`);
  loadEditor(null, file.name, text);
});

function downloadAsFile(name, content) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  setSaveStatus("Downloaded");
}

// --- Choosing where a new/unsaved file gets saved -------------------------

const saveTargetDialog = document.getElementById("save-target-dialog");
const chooseTargetButton = document.getElementById("choose-target-button");

chooseTargetButton.addEventListener("click", () => saveTargetDialog.showModal());
document.getElementById("save-target-cancel").addEventListener("click", () => saveTargetDialog.close());

document.getElementById("save-target-device").addEventListener("click", async () => {
  saveTargetDialog.close();
  if (!FS_ACCESS_SUPPORTED) {
    // No writable-handle API here -- a one-shot download is the closest
    // equivalent. Target stays unset so future edits keep offering this
    // chooser rather than silently downloading a new copy on every keystroke.
    downloadAsFile(filenameInput.value.trim() || "Untitled.txt", contentArea.value);
    return;
  }
  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: filenameInput.value.trim() || "Untitled.txt",
      types: TEXT_FILE_TYPES
    });
  } catch (e) {
    if (e.name !== "AbortError") debugLog("showSaveFilePicker failed: " + e.message);
    return;
  }
  filenameInput.value = handle.name;
  // Renaming a file with a live write handle would mean creating a whole new
  // file (Save As again), which this doesn't support -- lock the name field
  // rather than let an edit here silently do nothing.
  filenameInput.readOnly = true;
  setTarget({ type: "device", handle });
  save();
});

document.getElementById("save-target-drive").addEventListener("click", () => {
  saveTargetDialog.close();
  debugLog("Save to Google Drive chosen, signed in=" + Boolean(accessToken));
  if (!accessToken) {
    pendingAuthAction = "save-drive";
    tokenClient.requestAccessToken({ prompt: "consent" });
    return;
  }
  setTarget({ type: "drive", fileId: null, folderId: null });
  save();
});

// --- Loading a file ------------------------------------------------------

// Native Google formats (Docs/Sheets/Slides/...) have no raw text bytes to
// read — same "virtual document" problem the Android app already solved for
// attachments, just declined outright here rather than exported, since this
// is meant to be a plain text editor, not a format-converting one.
const UNSUPPORTED_PREFIX = "application/vnd.google-apps.";

async function openFile(fileId) {
  debugLog("openFile called with fileId=" + fileId);
  try {
    const meta = await driveFetch(`/drive/v3/files/${fileId}?fields=id,name,mimeType`);
    debugLog("Metadata response: " + JSON.stringify(meta));
    if (meta.mimeType.startsWith(UNSUPPORTED_PREFIX)) {
      showError(`"${meta.name}" is a Google ${meta.mimeType.split(".").pop()} file, not plain text — QuietPad can only edit plain text/markdown files.`);
      return;
    }
    const contentResponse = await driveFetch(`/drive/v3/files/${fileId}?alt=media`, { raw: true });
    const text = await contentResponse.text();
    debugLog(`Content fetched, ${text.length} chars`);
    loadEditor({ type: "drive", fileId, folderId: null }, meta.name, text);
    updateUrlState(fileId);
  } catch (e) {
    debugLog("openFile failed: " + (e && e.message ? e.message : e));
    // Shown on-page, not just logged to the console -- on a phone there's no
    // way to actually see the console, so a generic message here would leave
    // both the user and whoever's debugging this with nothing to go on.
    showError(`Couldn't load this file from Drive.\n\n${e && e.message ? e.message : e}`);
  }
}

/** Mirrors the Android app's own DriveSyncManager.findOrCreateAppFolder --
 *  same folder name, so a note created here shows up alongside the Android
 *  app's own notes instead of landing loose at Drive's root. A real report:
 *  "New file" had no folderId to pass to createFile at all in the
 *  standalone (non-Drive-handoff) case, so it fell back to Drive's default,
 *  the root of My Drive. */
async function findOrCreateAppFolder() {
  const q = encodeURIComponent(`name = '${APP_FOLDER_NAME}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`);
  const result = await driveFetch(`/drive/v3/files?q=${q}&orderBy=createdTime&fields=files(id)`);
  if (result.files && result.files.length > 0) {
    debugLog("Found existing QuietPad folder: " + result.files[0].id);
    return result.files[0].id;
  }
  debugLog("No QuietPad folder found, creating one");
  const response = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: APP_FOLDER_NAME, mimeType: FOLDER_MIME_TYPE })
  });
  if (!response.ok) throw new Error(`Drive API ${response.status}`);
  const created = await response.json();
  debugLog("Created QuietPad folder: " + created.id);
  return created.id;
}

// Only reached via a real Drive "New" hand-off (state.action === "create"),
// so the target is Drive from the start -- the user explicitly invoked this
// from inside Drive's own UI, already signed in by the time this runs.
async function startNewFile(folderId) {
  debugLog("startNewFile called, folderId=" + folderId);
  let targetFolderId = folderId;
  if (!targetFolderId) {
    try {
      targetFolderId = await findOrCreateAppFolder();
    } catch (e) {
      // Better to still create the file (at Drive's root) than to block
      // "New file" entirely just because the folder lookup itself failed.
      debugLog("findOrCreateAppFolder failed, falling back to Drive root: " + (e && e.message ? e.message : e));
    }
  }
  // Deferred creation, same reasoning as the Android app's own lazy note
  // creation: nothing is actually written to Drive until there's real
  // content to save, so abandoning a blank "New file" leaves nothing behind.
  loadEditor({ type: "drive", fileId: null, folderId: targetFolderId }, "Untitled.txt", "");
}

// The start screen's own "New file" button -- no target at all yet (not
// Drive, not device). Autosave is a no-op until the user picks one via the
// save-target dialog (see chooseTargetButton), same as a blank Notepad
// buffer not writing anywhere until the first real Save.
function startBlankDraft() {
  debugLog("New file button clicked (blank draft, no target yet)");
  loadEditor(null, "Untitled.txt", "");
}

// --- Editor ---------------------------------------------------------------

// null | { type: "drive", fileId, folderId } | { type: "device", handle }
// -- where the currently-open file will be saved. null means "not decided
// yet" (a blank draft, or a file opened via the no-File-System-Access-API
// fallback with nothing writable behind it): scheduleAutosave becomes a
// no-op in that state, and chooseTargetButton is the only way forward.
let currentTarget = null;
let currentFileName = "";
let savedContent = "";
let saveTimer = null;

const filenameInput = document.getElementById("filename-input");
const contentArea = document.getElementById("content-area");
const saveStatus = document.getElementById("save-status");

function setTarget(target) {
  currentTarget = target;
  chooseTargetButton.hidden = Boolean(target);
}

function loadEditor(target, name, text) {
  debugLog(`loadEditor: target=${JSON.stringify(target)} name=${JSON.stringify(name)} textLen=${text.length}`);
  setTarget(target);
  currentFileName = name;
  savedContent = text;
  filenameInput.value = name;
  // Renaming a device file with a live write handle isn't supported (would
  // mean creating a new file via Save As) -- lock the name field for that
  // one case rather than let an edit to it silently do nothing.
  filenameInput.readOnly = Boolean(target && target.type === "device");
  contentArea.value = text;
  // Explicit, defensive: neither should ever be true, since nothing in this
  // file sets them -- but a real report of a selectable-but-uneditable
  // content area (readOnly's exact signature, unlike disabled) with no way
  // to see a console on the phone it happened on means "nothing sets it" is
  // a claim worth actively enforcing here, not just trusting.
  contentArea.readOnly = false;
  contentArea.disabled = false;
  setSaveStatus(target ? "Saved" : "Not saved");
  showScreen("editor");
  contentArea.focus();
}

function setSaveStatus(text, isError) {
  saveStatus.textContent = text;
  saveStatus.classList.toggle("error", Boolean(isError));
}

function scheduleAutosave() {
  if (!currentTarget) { setSaveStatus("Not saved"); return; }
  clearTimeout(saveTimer);
  setSaveStatus("Saving…");
  saveTimer = setTimeout(save, AUTOSAVE_DEBOUNCE_MS);
}

contentArea.addEventListener("input", scheduleAutosave);
filenameInput.addEventListener("input", scheduleAutosave);

// Flush on the way out, same reasoning as the Android app's own
// flushPendingSave: don't let a debounce window silently drop the last edit
// if the tab closes or navigates away right after typing stops.
window.addEventListener("beforeunload", () => {
  if (saveTimer) { clearTimeout(saveTimer); save(); }
});

async function save() {
  if (!currentTarget) { setSaveStatus("Not saved"); return; }
  const content = contentArea.value;
  const name = filenameInput.value.trim() || "Untitled.txt";
  const alreadyExists = currentTarget.type === "device" || Boolean(currentTarget.fileId);
  if (content === savedContent && name === currentFileName && alreadyExists) {
    setSaveStatus("Saved");
    return;
  }
  try {
    if (currentTarget.type === "drive") {
      if (!currentTarget.fileId) {
        currentTarget.fileId = await createFile(name, content, currentTarget.folderId);
        debugLog("Created Drive file: " + currentTarget.fileId);
        updateUrlState(currentTarget.fileId);
      } else {
        if (name !== currentFileName) await updateMetadata(currentTarget.fileId, name);
        await updateContent(currentTarget.fileId, content);
      }
    } else if (currentTarget.type === "device") {
      const writable = await currentTarget.handle.createWritable();
      await writable.write(content);
      await writable.close();
    }
    currentFileName = name;
    savedContent = content;
    setSaveStatus("Saved");
  } catch (e) {
    debugLog("save failed: " + (e && e.message ? e.message : e));
    const message = currentTarget.type === "device" ? "Couldn't save to device" : "Couldn't save — check your connection";
    setSaveStatus(message, true);
  }
}

// Ctrl/Cmd+S: flush an existing target immediately (skip the debounce), or
// open the save-target chooser for a still-undecided draft -- the click that
// opens a native save dialog has to come from a direct user gesture like
// this key handler, never from the autosave timer.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
  if (screens.editor.hidden) return;
  e.preventDefault();
  if (currentTarget) {
    clearTimeout(saveTimer);
    save();
  } else {
    saveTargetDialog.showModal();
  }
});

// --- Drive REST calls -------------------------------------------------

async function driveFetch(path, opts = {}) {
  const response = await fetch(`https://www.googleapis.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    // Google's own error responses are real JSON explaining exactly what
    // went wrong (permission denied, invalid file ID, etc.) -- surfacing
    // that instead of just the bare status code is the difference between
    // an actionable error and a guess, especially with no console access.
    const bodyText = await response.text().catch(() => "");
    throw new Error(`Drive API ${response.status}${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`);
  }
  return opts.raw ? response : response.json();
}

async function updateContent(fileId, content) {
  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "text/plain"
      },
      body: content
    }
  );
  if (!response.ok) throw new Error(`Drive API ${response.status}`);
}

async function updateMetadata(fileId, name) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error(`Drive API ${response.status}`);
}

/** Only the create path needs a real multipart body — it's the one call
 *  that must set metadata (name, parent folder) and initial content together
 *  in a single request. */
async function createFile(name, content, folderId) {
  const metadata = { name, mimeType: "text/plain" };
  if (folderId) metadata.parents = [folderId];
  const boundary = "quietpad-" + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) + "\r\n" +
    `--${boundary}\r\n` +
    "Content-Type: text/plain\r\n\r\n" +
    content + "\r\n" +
    `--${boundary}--`;

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  if (!response.ok) throw new Error(`Drive API ${response.status}`);
  const created = await response.json();
  return created.id;
}

// Safety net: any uncaught error anywhere on this page surfaces on the error
// screen instead of leaving a confusing half-loaded UI with nothing to go
// on -- added after a real report of exactly that (a filename that looked
// like an error message, a content area that wouldn't accept typing) with
// no way to see what actually went wrong, since there's no console access
// on a phone.
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
