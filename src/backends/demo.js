// Development-only in-memory backend (open /edit/?demo in `npm run dev`): lets the UI be
// exercised and screenshotted without a Google sign-in. Never imported by production code.
const day = 86_400_000;

export function createDemoBackend() {
  const now = Date.now();
  let seq = 100;
  const files = new Map();
  const add = (name, text, ago, extra = {}) => {
    const id = `demo-${seq++}`;
    files.set(id, { id, name, text, modified: now - ago, mime: "application/vnd.quietpad.note+markdown", pinned: false, color: null, ...extra });
  };
  add("Shopping list.md", "- [ ] Milk\n- [x] Eggs\n- [ ] Coffee\n\nAlso #home", 3_600_000, { pinned: true, color: "yellow" });
  add("Trip to Lisbon.md", "# Lisbon\n\nFlights booked for **March**. Ideas: Alfama, Belém, day trip to Sintra.\n\n[Photo 2026-09-24 11-33-38.jpg](./Photo 2026-09-24 11-33-38.jpg)\n", 2 * day, { color: "blue" });
  add("Meeting notes (2).md", "Kick-off with the design team\n\n1. Scope\n2. Timeline\n3. Budget #work", 5 * day);
  add("New note (14).md", "Video attached\n[Video 2026-09-24 14-16-02.mp4](./Video 2026-09-24 14-16-02.mp4)", 6 * day);
  add("Recipe - pancakes.md", "Flour, milk, eggs. Rest the batter 20 minutes. #food", 20 * day, { color: "orange" });
  add("आज आपका", "यह एक हिंदी नोट है", 30 * day);
  add("Diary 2026-09-25 17-45.md", "Friday 25 September 2026, 17:45  #Diary\n\nWent to the market.", 1 * day);
  add("Diary 2026-09-11 09-30.md", "Friday 11 September 2026, 09:30  #Diary\n\nSlow morning.", 14 * day);
  const svg = (label) =>
    `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#dce2ff"/><text x="120" y="95" font-size="16" text-anchor="middle" fill="#1a56db">${label}</text></svg>`)}`;
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), 120));
  const meta = ({ text, ...m }) => ({ ...m });

  return {
    kind: "demo",
    label: "Demo notes",
    trashedMessage: "Note deleted.",
    listNotes: () => delay([...files.values()].map(meta)),
    readNote: (id) => delay({ ...files.get(id) }),
    getModified: (id) => delay(files.get(id).modified),
    async writeNote(id, text) {
      const f = files.get(id);
      f.text = text;
      f.modified = Date.now();
      return delay(f.modified);
    },
    async createNote(name, text) {
      const id = `demo-${seq++}`;
      const f = { id, name, text, modified: Date.now(), mime: "application/vnd.quietpad.note+markdown", pinned: false, color: null };
      files.set(id, f);
      return delay(meta(f));
    },
    async renameNote(id, name) {
      const f = files.get(id);
      f.name = name;
      f.modified = Date.now();
      return delay({ id, modified: f.modified });
    },
    trashNote: (id) => delay(files.delete(id)),
    async setProps(id, { pinned, color }) {
      Object.assign(files.get(id), { pinned, color });
      return delay(Date.now());
    },
    attachmentIndex: () => delay(new Map()),
    attachmentUrl: (name) => delay(/\.(jpg|png)$/i.test(name) ? svg(name) : null)
  };
}
