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

// ---- Diary (same rules as the Android app) ------------------------------------------------
// A diary entry is a note whose name is "Diary yyyy-MM-dd HH-mm.md" or which carries a #Diary
// tag. Diary notes are kept out of the ordinary list and shown only in the Diary view.

const DIARY_NAME = /^Diary (\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})/;
const DIARY_TAG = /(?:^|\s)#diary(?![\w-])/i;
const DIARY_HEADER = /^[A-Za-z]+ \d{1,2} [A-Za-z]+ \d{4}, \d{2}:\d{2}/;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");

/** The date in a diary file name, or null. */
export function diaryDateFromName(name) {
  const m = DIARY_NAME.exec(name || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

export const hasDiaryTag = (text) => DIARY_TAG.test(text || "");
export const isDiaryNote = (name, text) => !!diaryDateFromName(name) || hasDiaryTag(text);

/** True if this entry's first line (and file name) are locked: made as a diary entry. */
export const isLockedDiaryEntry = (name, text) => {
  if (diaryDateFromName(name)) return true;
  const first = (text || "").split("\n")[0];
  return hasDiaryTag(first) && DIARY_HEADER.test(first);
};

export const diaryFileName = (d) => `Diary ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}.md`;

/** First line of a new entry: "Friday 25 September 2026, 17:45  #Diary" (the tag ends the line so the app doesn't draw it as a heading). */
export const diaryHeader = (d) =>
  `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}  #Diary\n\n`;

/** Tab label for a diary entry: the date only, in the browser's own short order (25/09 or 09/25). */
export const diaryTabLabel = (name) => {
  const d = diaryDateFromName(name);
  return d ? d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" }) : null;
};

/** Long label for a diary row in the Diary list. */
export const diaryRowTitle = (name) => {
  const d = diaryDateFromName(name);
  return d ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : null;
};

/** True if [next] still starts with [prev]'s first line unchanged. */
export function headerIntact(prev, next) {
  const header = prev.split("\n")[0];
  return next === header || next.startsWith(header + "\n");
}
