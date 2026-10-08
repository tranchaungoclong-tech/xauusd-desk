import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(ROOT, "private", "notes.json");
const KEY = "notes:philip";
const MAX_NOTES = 80;
const MAX_LEN = 800;

function emptyPack() {
  return { notes: [], lastAdvise: "", at: 0 };
}

export function clampNote(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
}

export function readPack() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const j = JSON.parse(raw);
    if (!j || !Array.isArray(j.notes)) return emptyPack();
    return {
      notes: j.notes.slice(-MAX_NOTES).map(function (n) {
        return {
          t: Number(n.t) || 0,
          text: clampNote(n.text)
        };
      }).filter(function (n) { return n.text; }),
      lastAdvise: String(j.lastAdvise || "").slice(0, 4000),
      at: Number(j.at) || 0
    };
  } catch (e) {
    return emptyPack();
  }
}

export function writePack(pack) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const next = {
    notes: (pack.notes || []).slice(-MAX_NOTES),
    lastAdvise: String(pack.lastAdvise || "").slice(0, 4000),
    at: Number(pack.at) || Date.now()
  };
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

export function addNote(text) {
  const line = clampNote(text);
  if (!line) throw new Error("empty note");
  const pack = readPack();
  pack.notes.push({ t: Date.now(), text: line });
  pack.at = Date.now();
  return writePack(pack);
}

export { KEY, MAX_NOTES, MAX_LEN };
