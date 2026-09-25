import { useEffect, useRef, useState } from "preact/hooks";
import { auth, signOut, needsReconnect, reconnect } from "./auth.js";
import { localFoldersSupported } from "./backends/local.js";
import { savedFolder, startError, lastMode, enterDrive, driveSignIn, chooseFolder, continueFolder, forgetFolder, switchStorage } from "./session.js";
import {
  backend, notes, listStatus, tabs, activeId, docs, query, texts, mobileView, toast,
  visibleNotes, searching, loadNotes, refreshNotes, openNote, activateTab, closeTab, closeAllTabs, newNote,
  editText, retryLoad, retrySave, resolveConflict, renameNote, setPinned, setColor, deleteNote
} from "./store.js";
import { NOTE_COLORS, colorFor, titleOf, snippetOf, formatDate, attachmentNames } from "./util.js";

// ---- Sign in ---------------------------------------------------------------------------

export function Start() {
  const a = auth.value;
  const busy = a.status === "signingIn";
  const folder = savedFolder.value;
  const err = a.error || startError.value;
  const localFirst = lastMode() === "local";
  const driveBtn =
    a.status === "signedIn" ? (
      <button class={localFirst ? "secondary" : "primary big"} onClick={enterDrive}>Continue with Google Drive{a.email ? ` (${a.email})` : ""}</button>
    ) : (
      <button class={localFirst ? "secondary" : "primary big"} disabled={busy} onClick={driveSignIn}>{busy ? "Signing in…" : "Sign in with Google Drive"}</button>
    );
  const localBtns = localFoldersSupported() ? (
    <>
      {folder && <button class={localFirst ? "primary big" : "secondary"} onClick={continueFolder}>Continue with folder “{folder.name}”</button>}
      <button class="secondary" onClick={chooseFolder}>{folder ? "Choose a different folder" : "Open a folder on this computer"}</button>
    </>
  ) : null;
  return (
    <div class="signin">
      <div class="signin-card">
        <img src="/icons/icon-192.png" alt="" width="72" height="72" />
        <h1>QuietPad</h1>
        <p class="muted">Plain-text notes you own. Keep them in your Google Drive, or in any folder on this computer, and open the same notes on your phone. No ads.</p>
        <div class="choices">
          {localFirst ? localBtns : driveBtn}
          {localFirst ? driveBtn : localBtns}
        </div>
        {err && <p class="error" role="alert">{err}</p>}
        <p class="fine">
          {localFoldersSupported()
            ? "A folder works with Drive for desktop, Dropbox, OneDrive and other apps that keep it in sync. With Google Drive, QuietPad only ever sees the files it created."
            : "Working from a folder on your computer needs Chrome or Edge. With Google Drive, QuietPad only ever sees the files it created."}
        </p>
      </div>
    </div>
  );
}

// ---- Sidebar --------------------------------------------------------------------------------

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const a = auth.value;
  const be = backend.value;
  const isDrive = be?.kind === "drive";
  const isLocal = be?.kind === "local";
  return (
    <div class="account">
      <button class="ghost" onClick={() => setOpen(!open)} aria-expanded={open} title={isLocal ? be.label : a.email || "Account"}>
        {isLocal ? "📁" : (a.email || "?")[0].toUpperCase()}
      </button>
      {open && (
        <div class="popover account-pop" onClick={() => setOpen(false)}>
          <div class="muted small">{be?.label}</div>
          {isDrive && a.email && <div class="muted small">{a.email}</div>}
          <button class="link" onClick={switchStorage}>Switch storage…</button>
          {isDrive && <button class="link" onClick={async () => { await switchStorage(); signOut(); location.reload(); }}>Sign out of Google</button>}
          {isLocal && <button class="link" onClick={forgetFolder}>Forget this folder</button>}
        </div>
      )}
    </div>
  );
}

function NoteRow({ n }) {
  const active = tabs.value.includes(n.id) && activeId.value === n.id;
  const open = tabs.value.includes(n.id);
  const bg = colorFor(n.color);
  const snippet = snippetOf(texts.value[n.id]?.text);
  return (
    <li>
      <button class={`note-row ${active ? "active" : ""} ${open ? "open" : ""}`} style={bg ? { "--row-bg": bg } : undefined} onClick={() => openNote(n.id)}>
        <span class="row-top">
          <span class="row-title">{n.pinned && <span class="pin" title="Pinned">📌</span>}{titleOf(n.name)}</span>
          <span class="row-date">{formatDate(n.modified)}</span>
        </span>
        {snippet && <span class="row-snippet">{snippet}</span>}
      </button>
    </li>
  );
}

export function Sidebar() {
  const list = visibleNotes.value;
  const st = listStatus.value;
  return (
    <aside class="sidebar">
      <header class="side-head">
        <span class="brand"><img src="/icons/icon-192.png" alt="" width="24" height="24" /> QuietPad</span>
        <AccountMenu />
      </header>
      <div class="side-tools">
        <input type="search" class="search" placeholder="Search notes" aria-label="Search notes" value={query.value} onInput={(e) => (query.value = e.currentTarget.value)} />
        <button class="ghost refresh" onClick={() => refreshNotes({ force: true })} title="Refresh the list" aria-label="Refresh notes">↻</button>
        <button class="primary" onClick={() => newNote()}>+ New</button>
      </div>
      {st.error && (
        <div class="notice error" role="alert">
          Couldn't load your notes: {st.error} <button class="link" onClick={loadNotes}>Try again</button>
        </div>
      )}
      {st.loading && !notes.value.length && <p class="muted pad">Loading your notes…</p>}
      {!st.loading && !st.error && !notes.value.length && (
        <p class="muted pad">No notes yet. Tap <b>+ New</b> to write one; it will be saved in a “QuietPad” folder in your Drive.</p>
      )}
      {searching.value && !list.length && notes.value.length > 0 && <p class="muted pad">No notes match “{query.value}”.</p>}
      <ul class="note-list">{list.map((n) => <NoteRow key={n.id} n={n} />)}</ul>
    </aside>
  );
}

// ---- Tabs ----------------------------------------------------------------------------------

export function TabBar() {
  const ids = tabs.value;
  return (
    <div class="tabbar" role="tablist">
      <button class="back-to-list" onClick={() => (mobileView.value = "list")} aria-label="Back to all notes">← Notes</button>
      {ids.map((id) => {
        const d = docs.value[id];
        const active = id === activeId.value;
        const color = colorFor(d?.color);
        const dirty = d && (d.saveState === "dirty" || d.saveState === "saving");
        return (
          <div key={id} role="tab" aria-selected={active} class={`tab ${active ? "active" : ""}`} style={{ "--tab-bg": color || "var(--bg)" }} onClick={() => activateTab(id)} title={d?.name}>
            <span class="tab-title">{titleOf(d?.name || notes.value.find((n) => n.id === id)?.name)}</span>
            {dirty && <span class="dot" title="Saving…" />}
            <button class="tab-close" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(id); }}>✕</button>
          </div>
        );
      })}
      <button class="tab-add" onClick={() => newNote()} aria-label="New note" title="New note">+</button>
      {ids.length > 1 && <button class="link close-all" onClick={closeAllTabs}>Close all</button>}
    </div>
  );
}

// ---- Attachments -------------------------------------------------------------------------

const kindOf = (name) => {
  if (/\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(name)) return "image";
  if (/\.(mp4|webm|mov|m4v|3gp)$/i.test(name)) return "video";
  if (/\.(m4a|mp3|wav|ogg|aac|opus)$/i.test(name)) return "audio";
  return "file";
};

function Attachment({ name }) {
  const kind = kindOf(name);
  const [url, setUrl] = useState(null);
  const [state, setState] = useState(kind === "image" ? "loading" : "idle"); // idle | loading | ready | missing
  const load = async () => {
    setState("loading");
    try {
      const u = await backend.value.attachmentUrl(name);
      if (!u) return setState("missing");
      setUrl(u);
      setState("ready");
    } catch {
      setState("missing");
    }
  };
  useEffect(() => { if (kind === "image") load(); }, [name]);

  if (state === "missing") return <div class="att att-missing" title="Not found in your QuietPad Attachments folder">{name}<span class="small"> · not available</span></div>;
  if (kind === "image" && state === "ready") return <a class="att att-img" href={url} target="_blank" rel="noopener" title={name}><img src={url} alt={name} /></a>;
  if (state === "ready" && kind === "video") return <div class="att att-media"><video src={url} controls preload="metadata" /><span class="small">{name}</span></div>;
  if (state === "ready" && kind === "audio") return <div class="att att-media"><audio src={url} controls /><span class="small">{name}</span></div>;
  if (state === "ready") return <a class="att att-file" href={url} download={name}>⬇ {name}</a>;
  const label = { image: "🖼", video: "▶", audio: "🎧", file: "📎" }[kind];
  return <button class="att att-file" disabled={state === "loading"} onClick={load}>{state === "loading" ? "Loading…" : `${label} ${name}`}</button>;
}

function Attachments({ text }) {
  const names = attachmentNames(text || "");
  if (!names.length) return null;
  return <div class="attachments">{names.map((n) => <Attachment key={n} name={n} />)}</div>;
}

// ---- Editor ----------------------------------------------------------------------------

const STATUS_TEXT = { saved: "Saved", dirty: "Unsaved…", saving: "Saving…", error: "Couldn't save", conflict: "Changed elsewhere" };

function TitleField({ d }) {
  const [value, setValue] = useState(titleOf(d.name));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setValue(titleOf(d.name)); }, [d.name, d.id]);
  const commit = () => { focused.current = false; if (value.trim() && value.trim() !== titleOf(d.name)) renameNote(d.id, value); else setValue(titleOf(d.name)); };
  return (
    <input class="title" value={value} aria-label="Note title" onFocus={() => (focused.current = true)} onInput={(e) => setValue(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}

function Toolbar({ d }) {
  const [colorOpen, setColorOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div class="doc-actions">
      <button class="ghost" title={d.pinned ? "Unpin" : "Pin to top"} aria-pressed={!!d.pinned} onClick={() => setPinned(d.id, !d.pinned)}>{d.pinned ? "📌 Pinned" : "📌 Pin"}</button>
      <span class="color-wrap">
        <button class="ghost" onClick={() => setColorOpen(!colorOpen)} aria-expanded={colorOpen}>🎨 Colour</button>
        {colorOpen && (
          <div class="popover color-pop" onClick={() => setColorOpen(false)}>
            <button class="swatch none" title="No colour" onClick={() => setColor(d.id, null)}>∅</button>
            {Object.keys(NOTE_COLORS).map((k) => (
              <button key={k} class={`swatch ${d.color === k ? "on" : ""}`} title={k} style={{ background: colorFor(k) }} onClick={() => setColor(d.id, k)} />
            ))}
          </div>
        )}
      </span>
      {!confirming ? (
        <button class="ghost danger" onClick={() => setConfirming(true)}>Delete</button>
      ) : (
        <span class="confirm">
          {d.draft ? "Discard this draft?" : "Move to Drive bin?"}
          <button class="danger-solid" onClick={() => deleteNote(d.id)}>Yes</button>
          <button class="ghost" onClick={() => setConfirming(false)}>No</button>
        </span>
      )}
    </div>
  );
}

function Banners({ d }) {
  return (
    <>
      {needsReconnect.value && (
        <div class="notice warn" role="alert">
          Your Google session expired, so changes can't be saved yet. <button class="link" onClick={reconnect}>Reconnect</button>
        </div>
      )}
      {d.saveState === "conflict" && (
        <div class="notice warn" role="alert">
          This note was changed somewhere else (for example on your phone) since you opened it.
          <span class="btn-row">
            <button onClick={() => resolveConflict(d.id, "theirs")}>Use the other version</button>
            <button onClick={() => resolveConflict(d.id, "mine")}>Keep mine</button>
            <button onClick={() => resolveConflict(d.id, "copy")}>Keep both</button>
          </span>
        </div>
      )}
      {d.saveState === "error" && (
        <div class="notice error" role="alert">
          {d.error || "Couldn't save."} <button class="link" onClick={() => retrySave(d.id)}>Try again</button>
        </div>
      )}
    </>
  );
}

export function Editor() {
  const id = activeId.value;
  const d = id ? docs.value[id] : null;
  const areaRef = useRef(null);
  useEffect(() => { if (d?.status === "ready" && areaRef.current && !("ontouchstart" in window)) areaRef.current.focus(); }, [id, d?.status]);

  if (!id) {
    return (
      <div class="empty-main">
        <p class="muted">Pick a note from the list, or start a new one.</p>
        <button class="primary" onClick={() => newNote()}>+ New note</button>
      </div>
    );
  }
  if (!d || d.status === "loading") return <div class="empty-main"><p class="muted">Opening…</p></div>;
  if (d.status === "error") {
    return (
      <div class="empty-main">
        <p class="error">Couldn't open this note: {d.error}</p>
        <button class="primary" onClick={() => retryLoad(id)}>Try again</button>
      </div>
    );
  }
  const bg = colorFor(d.color);
  return (
    <section class="editor" style={{ "--note-bg": bg || "var(--bg)" }}>
      <div class="doc-head">
        <TitleField d={d} />
        <span class={`status status-${d.saveState}`} aria-live="polite">{d.draft && !d.text.trim() ? "Not saved yet" : STATUS_TEXT[d.saveState]}</span>
      </div>
      <Toolbar key={id} d={d} />
      <Banners d={d} />
      <Attachments key={`a-${id}`} text={d.text} />
      <textarea ref={areaRef} class="body" spellcheck="true" aria-label="Note text" placeholder="Start writing…" value={d.text} onInput={(e) => editText(id, e.currentTarget.value)} />
    </section>
  );
}

export function Toast() {
  const t = toast.value;
  return t ? <div class="toast" role="status">{t.message}</div> : null;
}

export { mobileView };
