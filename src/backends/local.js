// A folder on the user's own computer as a QuietPad storage backend, through the browser's
// File System Access API (Chrome and Edge). Notes are plain files in the folder they pick;
// photos/videos live in an "Attachments" subfolder, the same layout as the Drive backend and
// the Android app. Point it at a folder that Drive for desktop, Dropbox, OneDrive etc. keeps
// in sync and the notes follow along — QuietPad itself never talks to those services.

const NOTE_FILE = /\.(md|markdown|txt)$/i;
const META_FILE = ".quietpad.json"; // pin/colour, which a plain file has nowhere else to keep
const TRASH_DIR = ".trash";
const ATTACHMENTS_DIR = "Attachments";

export const localFoldersSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

export async function pickFolder() {
  return window.showDirectoryPicker({ id: "quietpad-notes", mode: "readwrite" });
}

/** True if we can read and write the folder now (re-asking the user only when allowed to). */
export async function ensurePermission(handle, { ask }) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if (!ask) return false;
  return (await handle.requestPermission(opts)) === "granted";
}

async function exists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (e) {
    if (e.name === "NotFoundError") return false;
    throw e;
  }
}

async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
  return fh;
}

async function uniqueName(dir, name) {
  if (!(await exists(dir, name))) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!(await exists(dir, candidate))) return candidate;
  }
}

export function createLocalBackend(dir) {
  let attachDir; // undefined = not looked up yet, null = no Attachments folder
  const blobUrls = new Map();

  async function readMeta() {
    try {
      const file = await (await dir.getFileHandle(META_FILE)).getFile();
      return JSON.parse(await file.text()).notes || {};
    } catch {
      return {};
    }
  }
  async function writeMeta(notes) {
    await writeFile(dir, META_FILE, JSON.stringify({ notes }, null, 2));
  }
  const metaOf = (file, props) => ({
    id: file.name,
    name: file.name,
    mime: "text/markdown",
    modified: file.lastModified,
    pinned: !!props?.pinned,
    color: props?.color || null
  });

  return {
    kind: "local",
    label: `Folder: ${dir.name}`,
    trashedMessage: `Note moved to the “${TRASH_DIR}” folder inside your notes folder.`,

    async listNotes() {
      const props = await readMeta();
      const out = [];
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== "file" || !NOTE_FILE.test(name) || name.startsWith(".")) continue;
        out.push(metaOf(await handle.getFile(), props[name]));
      }
      return out;
    },

    async readNote(id) {
      const file = await (await dir.getFileHandle(id)).getFile();
      return { ...metaOf(file, (await readMeta())[id]), text: await file.text() };
    },

    async getModified(id) {
      return (await (await dir.getFileHandle(id)).getFile()).lastModified;
    },

    async writeNote(id, text) {
      const fh = await writeFile(dir, id, text);
      return (await fh.getFile()).lastModified;
    },

    async createNote(name, text) {
      const finalName = await uniqueName(dir, name);
      const fh = await writeFile(dir, finalName, text);
      return metaOf(await fh.getFile(), null);
    },

    /** The file name is the note's id here, so a rename returns the new id as well. */
    async renameNote(id, name) {
      if (name === id) return { id, modified: await this.getModified(id) };
      if (await exists(dir, name)) throw new Error("A note with that name already exists.");
      const fh = await dir.getFileHandle(id);
      let moved = false;
      if (typeof fh.move === "function") {
        try {
          await fh.move(name);
          moved = true;
        } catch {
          /* not supported for this file: fall back to copy + remove below */
        }
      }
      if (!moved) {
        await writeFile(dir, name, await (await fh.getFile()).arrayBuffer());
        await dir.removeEntry(id);
      }
      const props = await readMeta();
      if (props[id]) {
        props[name] = props[id];
        delete props[id];
        await writeMeta(props);
      }
      return { id: name, modified: (await (await dir.getFileHandle(name)).getFile()).lastModified };
    },

    /** A folder can't move things to a recycle bin, so "delete" parks the file in .trash. */
    async trashNote(id) {
      const trash = await dir.getDirectoryHandle(TRASH_DIR, { create: true });
      const stamped = await uniqueName(trash, id);
      await writeFile(trash, stamped, await (await (await dir.getFileHandle(id)).getFile()).arrayBuffer());
      await dir.removeEntry(id);
      const props = await readMeta();
      if (props[id]) {
        delete props[id];
        await writeMeta(props);
      }
    },

    async setProps(id, { pinned, color }) {
      const props = await readMeta();
      if (pinned || color) props[id] = { pinned: !!pinned, color: color || null };
      else delete props[id];
      await writeMeta(props);
      return this.getModified(id);
    },

    async attachmentIndex() {
      return new Map();
    },

    async attachmentUrl(name) {
      if (attachDir === undefined) {
        try {
          attachDir = await dir.getDirectoryHandle(ATTACHMENTS_DIR);
        } catch {
          attachDir = null;
        }
      }
      if (!attachDir) return null;
      if (blobUrls.has(name)) return blobUrls.get(name);
      try {
        const url = URL.createObjectURL(await (await attachDir.getFileHandle(name)).getFile());
        blobUrls.set(name, url);
        return url;
      } catch {
        return null;
      }
    }
  };
}
