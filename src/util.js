// Same six note colours (and light/dark values) as the Android app's NoteColor enum.
export const NOTE_COLORS = {
  red: { light: "#FFCDD2", dark: "#4A2328" },
  orange: { light: "#FFE0B2", dark: "#4A3620" },
  yellow: { light: "#FFF9C4", dark: "#47431F" },
  green: { light: "#C8E6C9", dark: "#23402A" },
  blue: { light: "#BBDEFB", dark: "#1E3A4C" },
  purple: { light: "#E1BEE7", dark: "#3A2A45" }
};

export const prefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches;

export function colorFor(key) {
  const c = NOTE_COLORS[key];
  return c ? (prefersDark() ? c.dark : c.light) : null;
}

const NOTE_EXT = /^(.*?)(\.(?:md|markdown|txt))$/i;

/** "Groceries.md" -> { stem: "Groceries", ext: ".md" }; names without a note extension keep ext "". */
export function splitName(name) {
  const m = NOTE_EXT.exec(name || "");
  return m ? { stem: m[1], ext: m[2] } : { stem: name || "", ext: "" };
}

export const titleOf = (name) => splitName(name).stem.trim() || "Untitled";

// Same rule as the Android app's AttachmentLinkParser: `[name](./file)`, greedy to the last
// ")" on the line, because a file name can itself contain parentheses ("Photo (1).jpg").
const LINK_LINE = /\[[^\]\n]*\]\(\.\/(.+)\)/g;

export function attachmentNames(text) {
  const names = new Set();
  for (const m of text.matchAll(LINK_LINE)) names.add(m[1]);
  return [...names];
}

export function snippetOf(text) {
  for (const raw of (text || "").split("\n")) {
    const line = raw
      .replace(LINK_LINE, "")
      .replace(/^\s*(?:[-*+]\s+\[[ xX]\]|#{1,6}|[-*+]|\d+[.)])\s+/, "")
      .replace(/[*_`~]/g, "")
      .trim();
    if (line) return line.slice(0, 140);
  }
  return "";
}

export function formatDate(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  const opts = { day: "numeric", month: "short" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}

export function isoDay(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}
