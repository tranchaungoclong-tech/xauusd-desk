import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(ROOT, "private", "notes.json");
const PHOTO_DIR = path.join(ROOT, "private", "photos");
const MAX_DAYS = 120;
const MAX_LEN = 2000;
const MAX_PHOTOS = 6;

function emptyPack() {
  return { days: [], lastAdvise: "", at: 0 };
}

export function clampNote(text) {
  return String(text || "").replace(/\r\n/g, "\n").trim().slice(0, MAX_LEN);
}

export function dayKey(v) {
  var s = String(v || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var dd = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + dd;
}

export function readPack() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const j = JSON.parse(raw);
    if (j && Array.isArray(j.days)) {
      return {
        days: j.days.slice(-MAX_DAYS),
        lastAdvise: String(j.lastAdvise || "").slice(0, 4000),
        at: Number(j.at) || 0
      };
    }
    if (j && Array.isArray(j.notes)) {
      var days = [];
      j.notes.forEach(function (n) {
        var d = n.day || (n.t ? new Date(n.t).toISOString().slice(0, 10) : dayKey());
        var hit = days.find(function (x) { return x.day === d; });
        if (!hit) {
          hit = { day: d, text: "", photos: [], t: n.t || 0 };
          days.push(hit);
        }
        hit.text = (hit.text ? hit.text + "\n" : "") + clampNote(n.text);
        hit.t = Math.max(hit.t || 0, n.t || 0);
      });
      return { days: days, lastAdvise: String(j.lastAdvise || ""), at: Number(j.at) || 0 };
    }
    return emptyPack();
  } catch (e) {
    return emptyPack();
  }
}

export function writePack(pack) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const next = {
    days: (pack.days || []).slice(-MAX_DAYS),
    lastAdvise: String(pack.lastAdvise || "").slice(0, 4000),
    at: Number(pack.at) || Date.now()
  };
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

function savePhoto(dataUrl, day, idx) {
  var m = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return "";
  var ext = m[1].indexOf("jpeg") >= 0 || m[1].indexOf("jpg") >= 0 ? "jpg" : "png";
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  var name = day + "-" + idx + "." + ext;
  fs.writeFileSync(path.join(PHOTO_DIR, name), Buffer.from(m[2], "base64"));
  return "/api/photo/" + name;
}

export function upsertDay(body) {
  var day = dayKey(body.day);
  var text = clampNote(body.text || body.note);
  var photosIn = Array.isArray(body.photos) ? body.photos.slice(0, MAX_PHOTOS) : [];
  if (!text && !photosIn.length) throw new Error("empty diary");
  var pack = readPack();
  var saved = [];
  photosIn.forEach(function (p, i) {
    var url = savePhoto(typeof p === "string" ? p : (p && (p.dataUrl || p.data)), day, Date.now() + i);
    if (url) saved.push(url);
  });
  var hit = pack.days.find(function (x) { return x.day === day; });
  if (!hit) {
    hit = { day: day, text: "", photos: [], t: Date.now() };
    pack.days.push(hit);
  }
  if (text) hit.text = hit.text ? hit.text + "\n" + text : text;
  hit.photos = (hit.photos || []).concat(saved).slice(-MAX_PHOTOS);
  hit.t = Date.now();
  pack.days.sort(function (a, b) { return String(a.day).localeCompare(String(b.day)); });
  pack.at = Date.now();
  return writePack(pack);
}

export function publicDays(pack) {
  return (pack.days || []).map(function (d) {
    return { day: d.day, text: d.text, photos: d.photos || [], t: d.t || 0 };
  });
}

export { FILE, PHOTO_DIR, MAX_DAYS, MAX_LEN };
