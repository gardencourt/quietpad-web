import { CONFIG } from "../config.js";
import { getToken, invalidateToken } from "../auth.js";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export class DriveError extends Error {
  constructor(status, body) {
    super(`Drive API ${status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    this.status = status;
  }
}

async function authed(url, init = {}, retry = true) {
  const token = await getToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` }
  });
  if (res.status === 401 && retry) {
    invalidateToken();
    return authed(url, init, false);
  }
  if (!res.ok) throw new DriveError(res.status, await res.text().catch(() => ""));
  return res;
}

const json = async (path, init) => (await authed(`${API}${path}`, init)).json();
const q = encodeURIComponent;
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function isNoteFile(f) {
  return (
    f.mimeType === CONFIG.NOTE_MIME ||
    f.mimeType === "text/markdown" ||
    f.mimeType === "text/plain" ||
    /\.(md|markdown|txt)$/i.test(f.name)
  );
}

function toMeta(f) {
  const props = f.appProperties || {};
  return {
    id: f.id,
    name: f.name,
    mime: f.mimeType,
    modified: Date.parse(f.modifiedTime),
    pinned: props.pinned === "true",
    color: props.color || null
  };
}

const NOTE_FIELDS = "id,name,mimeType,modifiedTime,appProperties";

/** Google Drive as a QuietPad storage backend: the same "QuietPad" folder, `.md` notes and
 *  "Attachments" subfolder the Android app syncs, using only the `drive.file` permission. */
export function createDriveBackend() {
  let appFolderId = null;
  let attachmentsIndex = null;
  const blobUrls = new Map();

  async function findFolder(name, parentId) {
    const parent = parentId ? ` and '${parentId}' in parents` : "";
    const res = await json(
      `/files?q=${q(`name = '${esc(name)}' and mimeType = '${CONFIG.FOLDER_MIME}' and trashed = false${parent}`)}` +
        `&orderBy=createdTime&fields=files(id)&pageSize=10`
    );
    return res.files?.[0]?.id ?? null;
  }

  async function createFolder(name, parentId) {
    const body = { name, mimeType: CONFIG.FOLDER_MIME };
    if (parentId) body.parents = [parentId];
    const res = await json("/files?fields=id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return res.id;
  }

  async function ensureAppFolder({ create }) {
    if (appFolderId) return appFolderId;
    appFolderId = await findFolder(CONFIG.APP_FOLDER_NAME);
    if (!appFolderId && create) appFolderId = await createFolder(CONFIG.APP_FOLDER_NAME);
    return appFolderId;
  }

  return {
    kind: "drive",
    label: "Google Drive",

    async listNotes() {
      const folder = await ensureAppFolder({ create: false });
      if (!folder) return [];
      const out = [];
      let pageToken = "";
      do {
        const res = await json(
          `/files?q=${q(`'${folder}' in parents and trashed = false and mimeType != '${CONFIG.FOLDER_MIME}'`)}` +
            `&fields=nextPageToken,files(${NOTE_FIELDS})&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`
        );
        out.push(...(res.files || []).filter(isNoteFile).map(toMeta));
        pageToken = res.nextPageToken || "";
      } while (pageToken);
      return out;
    },

    async readNote(id) {
      const [meta, content] = await Promise.all([
        json(`/files/${id}?fields=${NOTE_FIELDS}`),
        authed(`${API}/files/${id}?alt=media`).then((r) => r.text())
      ]);
      return { ...toMeta(meta), text: content };
    },

    async getModified(id) {
      const meta = await json(`/files/${id}?fields=modifiedTime`);
      return Date.parse(meta.modifiedTime);
    },

    /** Drive takes a media upload's Content-Type as the file's new mimeType, so the existing
     *  one is sent back — a fixed text/plain would strip the Android app's note tag. */
    async writeNote(id, text, mime) {
      const res = await authed(`${UPLOAD}/files/${id}?uploadType=media&fields=modifiedTime`, {
        method: "PATCH",
        headers: { "Content-Type": mime || CONFIG.NOTE_MIME },
        body: text,
        keepalive: text.length < 60_000
      });
      return Date.parse((await res.json()).modifiedTime);
    },

    async createNote(name, text) {
      const folder = await ensureAppFolder({ create: true });
      const metadata = { name, mimeType: CONFIG.NOTE_MIME, parents: [folder] };
      const boundary = `quietpad-${Math.random().toString(36).slice(2)}`;
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: ${CONFIG.NOTE_MIME}\r\n\r\n${text}\r\n--${boundary}--`;
      const res = await authed(`${UPLOAD}/files?uploadType=multipart&fields=${NOTE_FIELDS}`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body
      });
      return toMeta(await res.json());
    },

    async renameNote(id, name) {
      const res = await json(`/files/${id}?fields=modifiedTime`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      return Date.parse(res.modifiedTime);
    },

    /** Trashed, not permanently deleted — recoverable from Drive's own bin. */
    async trashNote(id) {
      await json(`/files/${id}?fields=id`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true })
      });
    },

    /** Pin/colour ride in Drive's appProperties, exactly as the Android app stores them. */
    async setProps(id, { pinned, color }) {
      const res = await json(`/files/${id}?fields=modifiedTime`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appProperties: { pinned: String(pinned), color: color ?? null } })
      });
      return Date.parse(res.modifiedTime);
    },

    async attachmentIndex() {
      if (attachmentsIndex) return attachmentsIndex;
      const map = new Map();
      const folder = await ensureAppFolder({ create: false });
      const attFolder = folder ? await findFolder(CONFIG.ATTACHMENTS_FOLDER_NAME, folder) : null;
      if (attFolder) {
        let pageToken = "";
        do {
          const res = await json(
            `/files?q=${q(`'${attFolder}' in parents and trashed = false`)}` +
              `&fields=nextPageToken,files(id,name,mimeType)&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`
          );
          for (const f of res.files || []) map.set(f.name, { id: f.id, mime: f.mimeType });
          pageToken = res.nextPageToken || "";
        } while (pageToken);
      }
      attachmentsIndex = map;
      return map;
    },

    async attachmentUrl(name) {
      const info = (await this.attachmentIndex()).get(name);
      if (!info) return null;
      if (blobUrls.has(info.id)) return blobUrls.get(info.id);
      const blob = await (await authed(`${API}/files/${info.id}?alt=media`)).blob();
      const url = URL.createObjectURL(blob);
      blobUrls.set(info.id, url);
      return url;
    }
  };
}
