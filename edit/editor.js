// QuietPad web editor. No backend of ours — every Drive call here goes
// straight from this page to Google's own API using the signed-in user's own
// OAuth token, the same "no server of ours" shape as the Android app. See
// config.js for the Client ID / API key this needs filled in before sign-in
// will actually work.

const AUTOSAVE_DEBOUNCE_MS = 1000;

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
    console.error("Unparseable Drive state", e);
    return null;
  }
}

const screens = {
  signin: document.getElementById("signin-screen"),
  picker: document.getElementById("picker-screen"),
  editor: document.getElementById("editor-screen"),
  error: document.getElementById("error-screen")
};

function showScreen(name) {
  for (const key in screens) screens[key].hidden = key !== name;
}

function showError(message) {
  document.getElementById("error-message").textContent = message;
  showScreen("error");
}

// --- Auth -------------------------------------------------------------

let accessToken = null;
let tokenClient = null;

/** Fires once Google's own identity script has actually loaded — the plain
 *  <script defer> tag alone doesn't guarantee `google` exists yet by the
 *  time this file starts running. */
function initAuthWhenReady() {
  if (typeof google === "undefined" || !google.accounts) {
    setTimeout(initAuthWhenReady, 100);
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: QUIETPAD_CONFIG.CLIENT_ID,
    scope: QUIETPAD_CONFIG.SCOPE,
    callback: (response) => {
      if (response.error) {
        console.error("Auth failed", response);
        return;
      }
      accessToken = response.access_token;
      onSignedIn();
    }
  });
  document.getElementById("signin-button").addEventListener("click", () => {
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
  // A Drive hand-off already implies the user is a real Google account
  // holder currently inside Drive — try a silent (no-prompt) token first so
  // opening a file via "Open with" doesn't force a visible sign-in click
  // when a session already exists.
  if (parseDriveState()) {
    tokenClient.requestAccessToken({ prompt: "" });
  }
}

function onSignedIn() {
  const state = parseDriveState();
  if (state && state.action === "open" && state.ids && state.ids[0]) {
    openFile(state.ids[0]);
  } else if (state && state.action === "create") {
    startNewFile(state.folderId || null);
  } else {
    showScreen("picker");
  }
}

// --- Picker (Notepad-style "File > Open") ------------------------------

let pickerLoaded = false;

function ensurePickerLoaded(onReady) {
  if (pickerLoaded) return onReady();
  gapi.load("picker", () => {
    pickerLoaded = true;
    onReady();
  });
}

function openPicker() {
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
        if (data.action === google.picker.Action.PICKED) {
          openFile(data.docs[0].id);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

document.getElementById("open-button").addEventListener("click", openPicker);
document.getElementById("new-button").addEventListener("click", () => startNewFile(null));

// --- Loading a file ------------------------------------------------------

// Native Google formats (Docs/Sheets/Slides/...) have no raw text bytes to
// read — same "virtual document" problem the Android app already solved for
// attachments, just declined outright here rather than exported, since this
// is meant to be a plain text editor, not a format-converting one.
const UNSUPPORTED_PREFIX = "application/vnd.google-apps.";

async function openFile(fileId) {
  try {
    const meta = await driveFetch(`/drive/v3/files/${fileId}?fields=id,name,mimeType`);
    // TEMPORARY, for live debugging a real report of a wrong-looking filename
    // despite correct content and an unmodified real Drive file -- shown
    // on-page (not just console.log, which is unreachable on a phone),
    // exactly as received, since something between this response and the
    // filename input ending up wrong isn't understood yet. Remove once
    // resolved.
    const debugEl = document.getElementById("debug-info");
    if (debugEl) debugEl.textContent = "DEBUG meta: " + JSON.stringify(meta);
    if (meta.mimeType.startsWith(UNSUPPORTED_PREFIX)) {
      showError(`"${meta.name}" is a Google ${meta.mimeType.split(".").pop()} file, not plain text — QuietPad can only edit plain text/markdown files.`);
      return;
    }
    const contentResponse = await driveFetch(`/drive/v3/files/${fileId}?alt=media`, { raw: true });
    const text = await contentResponse.text();
    loadEditor(fileId, meta.name, text);
  } catch (e) {
    console.error(e);
    // Shown on-page, not just logged to the console -- on a phone there's no
    // way to actually see the console, so a generic message here would leave
    // both the user and whoever's debugging this with nothing to go on.
    showError(`Couldn't load this file from Drive.\n\n${e && e.message ? e.message : e}`);
  }
}

function startNewFile(folderId) {
  // Deferred creation, same reasoning as the Android app's own lazy note
  // creation: nothing is actually written to Drive until there's real
  // content to save, so abandoning a blank "New file" leaves nothing behind.
  loadEditor(null, "Untitled.txt", "", folderId);
}

// --- Editor ---------------------------------------------------------------

let currentFileId = null;
let currentFolderId = null;
let currentFileName = "";
let savedContent = "";
let saveTimer = null;

const filenameInput = document.getElementById("filename-input");
const contentArea = document.getElementById("content-area");
const saveStatus = document.getElementById("save-status");

function loadEditor(fileId, name, text, folderId) {
  currentFileId = fileId;
  currentFolderId = folderId || null;
  currentFileName = name;
  savedContent = text;
  filenameInput.value = name;
  filenameInput.readOnly = false;
  contentArea.value = text;
  // Explicit, defensive: neither should ever be true, since nothing in this
  // file sets them -- but a real report of a selectable-but-uneditable
  // content area (readOnly's exact signature, unlike disabled) with no way
  // to see a console on the phone it happened on means "nothing sets it" is
  // a claim worth actively enforcing here, not just trusting.
  contentArea.readOnly = false;
  contentArea.disabled = false;
  setSaveStatus("Saved");
  showScreen("editor");
  contentArea.focus();
}

function setSaveStatus(text, isError) {
  saveStatus.textContent = text;
  saveStatus.classList.toggle("error", Boolean(isError));
}

function scheduleAutosave() {
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
  const content = contentArea.value;
  const name = filenameInput.value.trim() || "Untitled.txt";
  if (content === savedContent && name === currentFileName && currentFileId) {
    setSaveStatus("Saved");
    return;
  }
  try {
    if (!currentFileId) {
      currentFileId = await createFile(name, content, currentFolderId);
    } else {
      if (name !== currentFileName) await updateMetadata(currentFileId, name);
      await updateContent(currentFileId, content);
    }
    currentFileName = name;
    savedContent = content;
    setSaveStatus("Saved");
  } catch (e) {
    console.error(e);
    setSaveStatus("Couldn't save — check your connection", true);
  }
}

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
window.addEventListener("error", (e) => showError(`Unexpected error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  showError(`Unexpected error: ${reason && reason.message ? reason.message : reason}`);
});

initAuthWhenReady();
