import { signal } from "@preact/signals";
import { auth, signIn, trySilentSignIn } from "./auth.js";
import { activateBackend, restoreTabs, openNote, newNote, closeAllTabs, clearBackend } from "./store.js";
import { createDriveBackend } from "./backends/drive.js";
import { createLocalBackend, ensurePermission, pickFolder, localFoldersSupported } from "./backends/local.js";
import { idbGet, idbSet, idbDelete } from "./idb.js";

const MODE_KEY = "quietpad-web-mode"; // which storage was used last: "drive" | "local"
const FOLDER_KEY = "local-folder";

export const booting = signal(true);
export const savedFolder = signal(null); // the folder chosen on a previous visit, if any
export const startError = signal(null);
export const lastMode = () => localStorage.getItem(MODE_KEY);

/** Drive's "Open with QuietPad" / "New" hand-off arrives as ?state={"action":"open","ids":[…]}. */
function driveHandoff() {
  try {
    const raw = new URLSearchParams(location.search).get("state");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function enterDrive() {
  startError.value = null;
  localStorage.setItem(MODE_KEY, "drive");
  await activateBackend(createDriveBackend());
  const handoff = driveHandoff();
  if (handoff?.action === "open" && handoff.ids?.[0]) await openNote(handoff.ids[0]);
  else if (handoff?.action === "create") newNote();
  else await restoreTabs();
}

export async function driveSignIn() {
  startError.value = null;
  await signIn();
  if (auth.value.status === "signedIn") await enterDrive();
}

async function enterLocal(handle) {
  startError.value = null;
  localStorage.setItem(MODE_KEY, "local");
  await idbSet(FOLDER_KEY, handle);
  savedFolder.value = handle;
  await activateBackend(createLocalBackend(handle));
  await restoreTabs();
}

export async function chooseFolder() {
  try {
    const handle = await pickFolder();
    if (await ensurePermission(handle, { ask: true })) await enterLocal(handle);
    else startError.value = "QuietPad needs permission to read and write that folder.";
  } catch (e) {
    if (e?.name !== "AbortError") startError.value = `Couldn't open the folder: ${e?.message || e}`;
  }
}

export async function continueFolder() {
  const handle = savedFolder.value;
  if (!handle) return chooseFolder();
  try {
    if (await ensurePermission(handle, { ask: true })) await enterLocal(handle);
    else startError.value = "QuietPad needs permission to read and write that folder.";
  } catch (e) {
    startError.value = `Couldn't open “${handle.name}”: ${e?.message || e}. Choose the folder again.`;
  }
}

export async function forgetFolder() {
  await idbDelete(FOLDER_KEY);
  savedFolder.value = null;
  await switchStorage();
}

export async function switchStorage() {
  await closeAllTabs();
  clearBackend();
}

/** Page load: go straight back into the last-used storage when that needs no click. */
export async function boot() {
  try {
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo") && new URLSearchParams(location.search).get("demo") !== "opfs") {
      const { createDemoBackend } = await import("./backends/demo.js");
      auth.value = { status: "signedIn", email: "demo@example.com", error: null };
      await activateBackend(createDemoBackend());
      await restoreTabs();
      return;
    }
    // Development only: run the real local-folder backend against the browser's private
    // sandbox folder (no native folder picker needed) so it can be exercised automatically.
    if (import.meta.env.DEV && new URLSearchParams(location.search).get("demo") === "opfs") {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("quietpad-test", { create: true });
      let empty = true;
      for await (const _ of dir.entries()) { empty = false; break; }
      if (empty) {
        const seed = { "Ideas.md": "Ideas for the garden #home\n", "Todo.md": "- [ ] Call plumber\n- [x] Buy bread\n" };
        for (const [name, text] of Object.entries(seed)) {
          const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
          await w.write(text);
          await w.close();
        }
      }
      await activateBackend(createLocalBackend(dir));
      await restoreTabs();
      return;
    }
    if (localFoldersSupported()) savedFolder.value = (await idbGet(FOLDER_KEY)) || null;
    const mode = lastMode();
    // A folder the browser still lets us use (no permission prompt needed) reopens by itself.
    if (mode === "local" && savedFolder.value && (await ensurePermission(savedFolder.value, { ask: false }))) {
      await enterLocal(savedFolder.value);
      return;
    }
    if (mode !== "local" && (await trySilentSignIn())) await enterDrive();
  } finally {
    booting.value = false;
  }
}
