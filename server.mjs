#!/usr/bin/env node
/**
 * Local FX pipe for XAUUSD Desk.
 * Bind: 127.0.0.1:4180
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchTick, fetchBars, ALLOWED, jsonHeaders } from "./feed.mjs";
import { readPack, upsertDay, writePack, publicDays, PHOTO_DIR } from "./notes-store.mjs";
import { snapshotFrom, askClaude, parsePath } from "./advise.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4180);

function jsonRes(res, code, body) {
  const s = JSON.stringify(body);
  const h = jsonHeaders();
  h["content-length"] = String(Buffer.byteLength(s));
  res.writeHead(code, h);
  res.end(s);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function serveFile(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  const abs = path.normalize(path.join(ROOT, rel));
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(abs, function (err, buf) {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const type = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": path.extname(abs) === ".html" ? "no-store" : "public, max-age=30"
    });
    res.end(buf);
  });
}

const server = http.createServer(function (req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "*"
    });
    res.end();
    return;
  }
  function readJson(cb) {
    const chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () {
      try { cb(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { cb({}); }
    });
  }
  const u = new URL(req.url, "http://127.0.0.1");
  if (u.pathname === "/api/tick") {
    fetchTick(u.searchParams.get("sym") || "XAUUSD").then(function (d) { jsonRes(res, d.ok ? 200 : 502, d); }).catch(function (e) {
      jsonRes(res, 502, { ok: false, err: [String(e.message || e)] });
    });
    return;
  }
  if (u.pathname === "/api/klines") {
    const iv = u.searchParams.get("interval") || "15m";
    if (!ALLOWED[iv]) {
      jsonRes(res, 400, { ok: false, err: ["bad interval"] });
      return;
    }
    fetchBars(iv, u.searchParams.get("sym") || "XAUUSD").then(function (d) { jsonRes(res, d.ok ? 200 : 502, d); }).catch(function (e) {
      jsonRes(res, 502, { ok: false, err: [String(e.message || e)] });
    });
    return;
  }
  if (u.pathname === "/api/health") {
    jsonRes(res, 200, {
      ok: true,
      port: PORT,
      notes: true,
      advise: !!process.env.ANTHROPIC_API_KEY
    });
    return;
  }
  if (u.pathname.indexOf("/api/photo/") === 0 && req.method === "GET") {
    const name = path.basename(u.pathname.slice("/api/photo/".length));
    const abs = path.join(PHOTO_DIR, name);
    fs.readFile(abs, function (err, buf) {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      const type = name.slice(-3) === "png" ? "image/png" : "image/jpeg";
      res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=86400" });
      res.end(buf);
    });
    return;
  }
  if (u.pathname === "/api/notes" && req.method === "GET") {
    const pack = readPack();
    jsonRes(res, 200, { ok: true, days: publicDays(pack), lastAdvise: pack.lastAdvise, at: pack.at });
    return;
  }
  if (u.pathname === "/api/notes" && req.method === "POST") {
    readJson(function (body) {
      try {
        const pack = upsertDay(body);
        jsonRes(res, 200, { ok: true, days: publicDays(pack), lastAdvise: pack.lastAdvise, at: pack.at });
      } catch (e) {
        jsonRes(res, 400, { ok: false, err: [String(e.message || e)] });
      }
    });
    return;
  }
  if (u.pathname === "/api/advise" && req.method === "POST") {
    readJson(function (body) {
      const pack = readPack();
      const snap = snapshotFrom({
        tf: body.tf,
        fx: body.fx,
        lastBar: body.lastBar,
        chartReads: body.chartReads,
        marks: body.marks,
        notes: publicDays(pack)
      });
      askClaude(process.env.ANTHROPIC_API_KEY, snap, body.images).then(function (text) {
        const pathDraw = parsePath(text);
        pack.lastAdvise = pathDraw.note || text;
        pack.at = Date.now();
        writePack(pack);
        jsonRes(res, 200, { ok: true, advise: pathDraw.note || text, path: pathDraw, notes: pack.notes, at: pack.at });
      }).catch(function (e) {
        jsonRes(res, 502, { ok: false, err: [String(e.message || e)] });
      });
    });
    return;
  }
  serveFile(req, res, u.pathname);
});

server.listen(PORT, HOST, function () {
  console.log("XAUUSD FX pipe http://" + HOST + ":" + PORT + "/");
});
