import { signal, computed, batch } from "@preact/signals";
import { splitName, titleOf, isoDay, isDiaryNote, diaryDateFromName, isLockedDiaryEntry, headerIntact, diaryFileName, diaryHeader } from "./util.js";

// ---- Global state -------------------------------------------------------------------

export const backend = signal(null); // the active storage backend (Drive, demo, later a local folder)
export const notes = signal([]); // note metadata: { id, name, mime, modified, pinned, color }
export const listStatus = signal({ loading: false, error: null });
export const tabs = signal([]); // open note ids (a not-yet-saved draft has an id like "draft-…")
export const activeId = signal(null);
export const docs = signal({}); // id -> open document state (see loadDoc)
export const query = signal("");
export const texts = signal({}); // id -> { modified, text }: cached bodies for search + snippets
export const view = signal("notes"); // "notes" or "diary": diary entries never appear in the notes view
export const mobileView = signal("list"); // narrow screens show either the list or the editor
export const toast = signal(null);

const SAVE_DEBOUNCE_MS = 1200;
const tabsKey = () => `quietpad-web-tabs:${backend.value?.kind ?? "none"}`;
const saveTimers = new Map();

const patchDoc = (id, patch) => {
  docs.value = { ...docs.value, [id]: { ...docs.value[id], ...patch } };
};
const patchMeta = (id, patch) => {
  notes.value = notes.value.map((n) => (n.id === id ? { ...n, ...patch } : n));
};

export function showToast(message) {
  toast.value = { message, at: Date.now() };
  const at = toast.value.at;
  setTimeout(() => {
    if (toast.value?.at === at) toast.value = null;
  }, 4000);
}

const errorText = (e) => (e && e.message ? e.message : String(e));

// ---- Sorting + search ----------------------------------------------------------------

const sortNotes = (list) =>
  [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.modified - a.modified);

/** Notes to show in the sidebar: everything (pinned first, newest first) or, with a query,
 *  those matching every word (or #tag), ranked title-first. */
export const visibleNotes = computed(() => {
  const wantDiary = view.value === "diary";
  const cache0 = texts.value;
  const list = notes.value.filter((n) => isDiaryNote(n.name, cache0[n.id]?.text) === wantDiary);
  const q = query.value.trim().toLowerCase();
  if (!q) {
    // Diary entries read newest date first (the date is in the name); notes: pinned, then newest edit.
    return wantDiary
      ? [...list].sort((a, b) => (diaryDateFromName(b.name)?.getTime() ?? b.modified) - (diaryDateFromName(a.name)?.getTime() ?? a.modified))
      : sortNotes(list);
  }
  const words = q.split(/\s+/).filter(Boolean);
  const cache = texts.value;
  const scored = [];
  for (const n of list) {
    const title = titleOf(n.name).toLowerCase();
    const body = (cache[n.id]?.text || "").toLowerCase();
    let score = 0;
    let all = true;
    for (const w of words) {
      const inTitle = title.includes(w);
      const inBody = w.startsWith("#")
        ? new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(body)
        : body.includes(w);
      if (!inTitle && !inBody) {
        all = false;
        break;
      }
      score += (inTitle ? 3 : 0) + (inBody ? 1 : 0);
    }
    if (all) scored.push({ n, score });
  }
  scored.sort((a, b) => b.score - a.score || Number(b.n.pinned) - Number(a.n.pinned) || b.n.modified - a.n.modified);
  return scored.map((s) => s.n);
});

export const searching = computed(() => query.value.trim().length > 0);

/** Fetch every note's text into the cache (a few at a time) so search and list snippets work. */
export async function prefetchTexts() {
  const be = backend.value;
  if (!be) return;
  const todo = notes.value.filter((n) => texts.value[n.id]?.modified !== n.modified);
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const n = todo[i++];
      try {
        const r = await be.readNote(n.id);
        texts.value = { ...texts.value, [n.id]: { modified: r.modified, text: r.text } };
      } catch {
        /* a note that can't be read just won't be searchable */
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

// ---- Loading -----------------------------------------------------------------------

export async function loadNotes() {
  const be = backend.value;
  if (!be) return;
  listStatus.value = { loading: true, error: null };
  try {
    const list = await be.listNotes();
    batch(() => {
      notes.value = list;
      listStatus.value = { loading: false, error: null };
    });
    prefetchTexts();
  } catch (e) {
    listStatus.value = { loading: false, error: errorText(e) };
  }
}

export function activateBackend(be) {
  batch(() => {
    backend.value = be;
    notes.value = [];
    docs.value = {};
    texts.value = {};
    tabs.value = [];
    activeId.value = null;
  });
  return loadNotes();
}

export function clearBackend() {
  batch(() => {
    backend.value = null;
    notes.value = [];
    docs.value = {};
    texts.value = {};
    tabs.value = [];
    activeId.value = null;
  });
}

let lastRefresh = 0;

/** Re-read the note list (e.g. when you come back to this tab after editing on your phone, or
 *  after a sync tool updated the folder), and reload any open note that changed underneath us
 *  and has no unsaved edits. A note you are mid-edit on is left alone; the conflict check at
 *  save time deals with that case. */
export async function refreshNotes({ force = false } = {}) {
  const be = backend.value;
  if (!be || listStatus.value.loading) return;
  if (!force && Date.now() - lastRefresh < 20000) return;
  lastRefresh = Date.now();
  try {
    const list = await be.listNotes();
    notes.value = list;
    prefetchTexts();
    for (const n of list) {
      const d = docs.value[n.id];
      if (d && d.status === "ready" && !d.draft && d.saveState === "saved" && d.loadedModified !== n.modified) loadDoc(n.id);
    }
  } catch {
    /* a failed background refresh is not worth interrupting anyone for */
  }
}

/** Storages whose note id is the file name (a local folder) get a new id when renamed. */
function remapId(oldId, newId) {
  const { [oldId]: oldDoc, ...restDocs } = docs.value;
  const { [oldId]: oldText, ...restTexts } = texts.value;
  batch(() => {
    docs.value = oldDoc ? { ...restDocs, [newId]: { ...oldDoc, id: newId } } : restDocs;
    texts.value = oldText ? { ...restTexts, [newId]: oldText } : restTexts;
    tabs.value = tabs.value.map((t) => (t === oldId ? newId : t));
    if (activeId.value === oldId) activeId.value = newId;
    notes.value = notes.value.map((n) => (n.id === oldId ? { ...n, id: newId } : n));
  });
  if (saveTimers.has(oldId)) {
    saveTimers.set(newId, saveTimers.get(oldId));
    saveTimers.delete(oldId);
  }
  persistTabs();
}

// ---- Tabs ------------------------------------------------------------------------------

function persistTabs() {
  try {
    localStorage.setItem(tabsKey(), JSON.stringify({ ids: tabs.value.filter((t) => !t.startsWith("draft-")), active: activeId.value }));
  } catch {
    /* storage unavailable (private window): tabs just won't be remembered */
  }
}

/** After the list loads: reopen last session's tabs, dropping notes that no longer exist. */
export async function restoreTabs() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(tabsKey()) || "null");
  } catch {
    saved = null;
  }
  if (!saved?.ids?.length) return;
  const known = new Set(notes.value.map((n) => n.id));
  const ids = saved.ids.filter((id) => known.has(id));
  if (!ids.length) return;
  tabs.value = ids;
  const active = ids.includes(saved.active) ? saved.active : ids[ids.length - 1];
  activeId.value = active;
  await loadDoc(active);
}

export async function openNote(id) {
  batch(() => {
    if (!tabs.value.includes(id)) tabs.value = [...tabs.value, id];
    activeId.value = id;
    mobileView.value = "editor";
  });
  persistTabs();
  if (!docs.value[id]) await loadDoc(id);
}

export function activateTab(id) {
  batch(() => {
    activeId.value = id;
    mobileView.value = "editor";
  });
  persistTabs();
  if (!docs.value[id]) loadDoc(id);
}

export async function closeTab(id) {
  await flush(id);
  const d = docs.value[id];
  // Closing a draft that never got any text leaves nothing behind (nothing was created yet).
  const idx = tabs.value.indexOf(id);
  const remaining = tabs.value.filter((t) => t !== id);
  batch(() => {
    tabs.value = remaining;
    if (activeId.value === id) {
      activeId.value = remaining[Math.min(idx, remaining.length - 1)] ?? null;
      if (!activeId.value) mobileView.value = "list";
    }
    const { [id]: _gone, ...rest } = docs.value;
    docs.value = rest;
  });
  persistTabs();
  if (activeId.value && !docs.value[activeId.value]) loadDoc(activeId.value);
  return d;
}

export function closeAllTabs() {
  return Promise.all(tabs.value.map((id) => flush(id))).then(() => {
    batch(() => {
      tabs.value = [];
      activeId.value = null;
      docs.value = {};
      mobileView.value = "list";
    });
    persistTabs();
  });
}

// ---- Documents ---------------------------------------------------------------------------

async function loadDoc(id) {
  const meta = notes.value.find((n) => n.id === id);
  patchDoc(id, { id, name: meta?.name ?? "", status: "loading", saveState: "saved", draft: false });
  try {
    const r = await backend.value.readNote(id);
    patchDoc(id, {
      status: "ready",
      name: r.name,
      text: r.text,
      savedText: r.text,
      loadedModified: r.modified,
      mime: r.mime,
      pinned: r.pinned,
      color: r.color,
      saveState: "saved",
      error: null
    });
    texts.value = { ...texts.value, [id]: { modified: r.modified, text: r.text } };
  } catch (e) {
    patchDoc(id, { status: "error", error: errorText(e) });
  }
}

export function retryLoad(id) {
  return loadDoc(id);
}

function uniqueName(base = "New note") {
  const taken = new Set([...notes.value.map((n) => n.name.toLowerCase()), ...Object.values(docs.value).map((d) => (d.name || "").toLowerCase())]);
  let name = `${base}.md`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} (${i}).md`;
  return name;
}

/** A new note stays a local draft until it has text — same idea as the Android app's lazy
 *  note creation — so opening "New note" and walking away leaves nothing in the folder. */
export function newNote() {
  const id = `draft-${Date.now()}`;
  docs.value = {
    ...docs.value,
    [id]: { id, name: uniqueName(), text: "", savedText: "", status: "ready", draft: true, saveState: "saved", pinned: false, color: null }
  };
  batch(() => {
    tabs.value = [...tabs.value, id];
    activeId.value = id;
    mobileView.value = "editor";
  });
  persistTabs();
  return id;
}

/** Returns false when the edit was refused (it would change a diary entry's locked first line). */
export function editText(id, text) {
  const d = docs.value[id];
  if (!d) return true;
  if (isLockedDiaryEntry(d.name, d.text) && !headerIntact(d.text, text)) {
    showToast("A diary entry's first line can't be edited.");
    return false;
  }
  patchDoc(id, { text, saveState: d.saveState === "conflict" ? "conflict" : "dirty" });
  if (d.saveState !== "conflict") schedule(id);
  return true;
}

/** Creates today's diary entry straight away (it has content: the dated first line). */
export async function newDiaryEntry() {
  const be = backend.value;
  if (!be) return;
  const now = new Date();
  const text = diaryHeader(now);
  try {
    const created = await be.createNote(diaryFileName(now), text);
    batch(() => {
      notes.value = [...notes.value, created];
      texts.value = { ...texts.value, [created.id]: { modified: created.modified, text } };
      view.value = "diary";
    });
    await openNote(created.id);
  } catch (e) {
    showToast(`Couldn't create the entry: ${errorText(e)}`);
  }
}

function schedule(id) {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(id, setTimeout(() => saveNow(id), SAVE_DEBOUNCE_MS));
}

/** Write any pending edit right away (used when closing a tab or leaving the page). */
export async function flush(id) {
  if (saveTimers.has(id)) {
    clearTimeout(saveTimers.get(id));
    saveTimers.delete(id);
  }
  const d = docs.value[id];
  if (d && (d.saveState === "dirty" || (d.draft && d.text.trim()))) await saveNow(id);
}

export const hasUnsavedChanges = () =>
  Object.values(docs.value).some((d) => d.saveState === "dirty" || d.saveState === "saving" || d.saveState === "conflict");

async function saveNow(id) {
  saveTimers.delete(id);
  const d = docs.value[id];
  const be = backend.value;
  if (!d || d.status !== "ready" || !be || d.saveState === "conflict" || d.saveState === "saving") return;

  if (d.draft) {
    if (!d.text.trim()) return;
    patchDoc(id, { saveState: "saving" });
    try {
      const created = await be.createNote(d.name, d.text);
      const at = tabs.value.indexOf(id);
      const { [id]: draftDoc, ...rest } = docs.value;
      batch(() => {
        docs.value = { ...rest, [created.id]: { ...draftDoc, id: created.id, draft: false, name: created.name, loadedModified: created.modified, mime: created.mime, savedText: d.text, saveState: "saved" } };
        tabs.value = tabs.value.map((t, i) => (i === at ? created.id : t));
        if (activeId.value === id) activeId.value = created.id;
        notes.value = [...notes.value, { ...created }];
        texts.value = { ...texts.value, [created.id]: { modified: created.modified, text: d.text } };
      });
      persistTabs();
      const latest = docs.value[created.id];
      if (latest && latest.text !== d.text) {
        patchDoc(created.id, { saveState: "dirty" });
        schedule(created.id);
      }
    } catch (e) {
      patchDoc(id, { saveState: "error", error: errorText(e) });
    }
    return;
  }

  if (d.text === d.savedText) {
    patchDoc(id, { saveState: "saved" });
    return;
  }
  patchDoc(id, { saveState: "saving" });
  try {
    // Last-write-wins would silently overwrite an edit made on the phone, so check first.
    const remote = await be.getModified(id);
    if (remote !== d.loadedModified) {
      patchDoc(id, { saveState: "conflict", conflictModified: remote });
      return;
    }
    const text = d.text;
    const modified = await be.writeNote(id, text, d.mime);
    patchDoc(id, { loadedModified: modified, savedText: text, saveState: docs.value[id]?.text === text ? "saved" : "dirty" });
    patchMeta(id, { modified });
    texts.value = { ...texts.value, [id]: { modified, text } };
    if (docs.value[id]?.text !== text) schedule(id);
  } catch (e) {
    patchDoc(id, { saveState: "error", error: errorText(e) });
  }
}

export function retrySave(id) {
  patchDoc(id, { saveState: "dirty" });
  return saveNow(id);
}

/** Resolve "changed elsewhere": keep mine, take theirs, or save mine as a separate copy. */
export async function resolveConflict(id, choice) {
  const d = docs.value[id];
  const be = backend.value;
  if (!d || !be) return;
  try {
    if (choice === "mine") {
      patchDoc(id, { loadedModified: d.conflictModified, saveState: "dirty" });
      await saveNow(id);
    } else if (choice === "theirs") {
      await loadDoc(id);
    } else if (choice === "copy") {
      const { stem, ext } = splitName(d.name);
      const copy = await be.createNote(`${stem}-conflict-${isoDay()}${ext || ".md"}`, d.text);
      notes.value = [...notes.value, copy];
      await loadDoc(id);
      showToast("Your version was saved as a separate note.");
    }
  } catch (e) {
    patchDoc(id, { saveState: "error", error: errorText(e) });
  }
}

export async function renameNote(id, title) {
  const d = docs.value[id];
  const clean = title.replace(/[\\/]/g, "-").trim();
  if (!d || !clean) return;
  const { ext } = splitName(d.name);
  const typed = splitName(clean);
  const name = typed.ext ? clean : `${clean}${ext || (d.draft ? ".md" : "")}`;
  if (name === d.name) return;
  if (d.draft) return patchDoc(id, { name });
  try {
    const { id: newId, modified } = await backend.value.renameNote(id, name);
    if (newId !== id) remapId(id, newId);
    patchDoc(newId, { name, loadedModified: modified });
    patchMeta(newId, { name, modified });
  } catch (e) {
    showToast(`Couldn't rename: ${errorText(e)}`);
  }
}

export async function setPinned(id, pinned) {
  return setProps(id, { pinned });
}

export async function setColor(id, color) {
  return setProps(id, { color });
}

async function setProps(id, change) {
  const d = docs.value[id];
  if (!d || d.draft) {
    if (d) patchDoc(id, change);
    return;
  }
  const next = { pinned: d.pinned, color: d.color, ...change };
  patchDoc(id, next);
  patchMeta(id, next);
  try {
    const modified = await backend.value.setProps(id, next);
    patchDoc(id, { loadedModified: modified });
  } catch (e) {
    patchDoc(id, { pinned: d.pinned, color: d.color });
    patchMeta(id, { pinned: d.pinned, color: d.color });
    showToast(`Couldn't update: ${errorText(e)}`);
  }
}

export async function deleteNote(id) {
  const d = docs.value[id];
  try {
    if (d && !d.draft) await backend.value.trashNote(id);
    notes.value = notes.value.filter((n) => n.id !== id);
    const { [id]: _t, ...restTexts } = texts.value;
    texts.value = restTexts;
    clearTimeout(saveTimers.get(id));
    saveTimers.delete(id);
    // Skip the flush in closeTab: the note is gone, there is nothing left to save.
    const { [id]: _d, ...rest } = docs.value;
    docs.value = rest;
    await closeTab(id);
    showToast(d && !d.draft ? backend.value?.trashedMessage || "Note deleted." : "Draft discarded.");
  } catch (e) {
    showToast(`Couldn't delete: ${errorText(e)}`);
  }
}

// Save whatever is pending when the tab is hidden or closed (keepalive lets the request
// outlive the page), and warn if something still hasn't reached Drive.
if (typeof window !== "undefined") {
  const flushAll = () => Object.keys(docs.value).forEach((id) => flush(id));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
    else refreshNotes();
  });
  window.addEventListener("pagehide", flushAll);
  window.addEventListener("beforeunload", (e) => {
    flushAll();
    if (hasUnsavedChanges()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
