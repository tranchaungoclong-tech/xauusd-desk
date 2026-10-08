import { fetchTick, fetchBars, ALLOWED, jsonHeaders } from "./feed.mjs";
import { snapshotFrom, askClaude, clampNote, parsePath } from "./advise.mjs";

const KEY = "notes:philip";
const MAX_NOTES = 80;

function corsHeaders() {
  const h = jsonHeaders();
  h["access-control-allow-methods"] = "GET, POST, OPTIONS";
  h["access-control-allow-headers"] = "content-type";
  return h;
}

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: corsHeaders() });
}

async function readBody(req) {
  try { return await req.json(); } catch (e) { return {}; }
}

async function getPack(env) {
  if (!env.NOTES) return { days: [], lastAdvise: "", at: 0 };
  const raw = await env.NOTES.get(KEY, "json");
  if (!raw) return { days: [], lastAdvise: "", at: 0 };
  if (Array.isArray(raw.days)) {
    return { days: raw.days.slice(-MAX_NOTES), lastAdvise: String(raw.lastAdvise || ""), at: Number(raw.at) || 0 };
  }
  return { days: [], lastAdvise: String(raw.lastAdvise || ""), at: Number(raw.at) || 0 };
}

async function putPack(env, pack) {
  if (!env.NOTES) throw new Error("NOTES KV not bound");
  const next = {
    days: (pack.days || []).slice(-MAX_NOTES),
    lastAdvise: String(pack.lastAdvise || "").slice(0, 4000),
    at: Date.now()
  };
  await env.NOTES.put(KEY, JSON.stringify(next));
  return next;
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const u = new URL(req.url);
    const path = u.pathname;
    try {
      if (path === "/api/tick" || path === "/tick") {
        const d = await fetchTick(u.searchParams.get("sym") || "XAUUSD");
        return json(d, d.ok ? 200 : 502);
      }
      if (path === "/api/klines" || path === "/klines") {
        const iv = u.searchParams.get("interval") || "15m";
        if (!ALLOWED[iv]) return json({ ok: false, err: ["bad interval"] }, 400);
        const d = await fetchBars(iv, u.searchParams.get("sym") || "XAUUSD");
        return json(d, d.ok ? 200 : 502);
      }
      if (path === "/api/health" || path === "/health") {
        return json({
          ok: true,
          pipe: "worker",
          notes: !!env.NOTES,
          advise: !!env.ANTHROPIC_API_KEY
        });
      }
      if (path === "/api/notes" && req.method === "GET") {
        const pack = await getPack(env);
        return json({ ok: true, days: pack.days || [], lastAdvise: pack.lastAdvise, at: pack.at });
      }
      if (path === "/api/notes" && req.method === "POST") {
        const body = await readBody(req);
        const day = String(body.day || "").slice(0, 10);
        const line = clampNote(body.text || body.note);
        var hasTrade = body.trade && (body.trade.side === "BUY" || body.trade.side === "SELL") && isFinite(Number(body.trade.entry));
        if (!line && !(body.photos && body.photos.length) && !hasTrade) return json({ ok: false, err: ["empty diary"] }, 400);
        const pack = await getPack(env);
        pack.days = pack.days || [];
        var hit = pack.days.find(function (x) { return x.day === day; });
        if (!hit) {
          hit = { day: day || new Date().toISOString().slice(0, 10), text: "", lines: [], photos: [], trades: [], t: Date.now() };
          pack.days.push(hit);
        }
        hit.lines = hit.lines || [];
        if (line) {
          hit.lines.push({ t: Date.now(), text: line });
          hit.text = hit.lines.map(function (l) { return l.text; }).join("\n");
        }
        if (body.trade && (body.trade.side === "BUY" || body.trade.side === "SELL") && isFinite(Number(body.trade.entry))) {
          hit.trades = hit.trades || [];
          hit.trades.push({
            side: body.trade.side,
            entry: Number(body.trade.entry),
            tp: isFinite(Number(body.trade.tp)) ? Number(body.trade.tp) : null,
            sl: isFinite(Number(body.trade.sl)) ? Number(body.trade.sl) : null,
            t: Date.now()
          });
        }
        hit.t = Date.now();
        const next = await putPack(env, pack);
        return json({ ok: true, days: next.days || [], lastAdvise: next.lastAdvise, at: next.at });
      }
      if (path === "/api/chat" && req.method === "POST") {
        if (!env.AI) return json({ ok: false, err: ["AI not on this pipe"] }, 502);
        const body = await readBody(req);
        const say = String(body.text || "").trim().slice(0, 1500);
        const img = String(body.image || "");
        const who = String(body.model || "llama");
        if (!say && !img) return json({ ok: false, err: ["empty"] }, 400);
        if (img && img.length > 1800000) return json({ ok: false, err: ["ảnh quá nặng, chụp lại nhỏ hơn"] }, 400);
        const ask = say || "Đọc ảnh chart này. Kẻ gì, hướng nào, vùng giá nào đọc được.";
        const rule = " Trả lời tiếng Việt, ngắn. Không bịa giá không có trên ảnh. Không phải lệnh sàn. Ảnh mờ thì nói mờ.";
        const hist = Array.isArray(body.history) ? body.history.slice(-6) : [];
        let out;
        if (who === "moondream") {
          if (img.indexOf("base64,") < 0) return json({ ok: false, err: ["Moondream cần ảnh"] }, 400);
          const b64 = img.split("base64,")[1];
          const bin = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
          const kind = img.indexOf("image/png") > 0 ? "image/png" : "image/jpeg";
          const form = new FormData();
          form.append("task", "query");
          form.append("question", ask + rule);
          form.append("image", new Blob([bin], { type: kind }), "chart.jpg");
          const res = await fetch("https://api.cloudflare.com/client/v4/accounts/" + env.CF_ACCOUNT + "/ai/run/@cf/moondream/moondream3.1-9B-A2B", {
            method: "POST",
            headers: { authorization: "Bearer " + env.CF_TOKEN },
            body: form
          });
          const j = await res.json();
          out = j.result || j;
        } else {
          const messages = [{
            role: "system",
            content: "Bạn nói tiếng Việt, ngắn, như người xem chart vàng với Philip. Ảnh là line/fib/khung của cao thủ. Mô tả đúng những gì thấy. Không bịa giá. Không phải lệnh sàn. Ảnh mờ thì nói mờ."
          }];
          hist.forEach(function (m) {
            if (!m || (m.role !== "user" && m.role !== "assistant")) return;
            const c = String(m.content || "").trim().slice(0, 800);
            if (c) messages.push({ role: m.role, content: c });
          });
          const user = { role: "user", content: ask };
          if (img.indexOf("base64,") > 0) {
            const raw = img.split("base64,")[1];
            if (who === "llava") user.data = raw;
            else user.image = [...Uint8Array.from(atob(raw), function (c) { return c.charCodeAt(0); })];
          }
          messages.push(user);
          const id = who === "llava"
            ? "@cf/llava-hf/llava-1.5-7b-hf"
            : "@cf/meta/llama-3.2-11b-vision-instruct";
          try {
            out = await env.AI.run(id, { messages: messages, max_tokens: 500 });
          } catch (err) {
            const msg = String(err && err.message || err);
            if (who !== "llava" && /agree/i.test(msg)) {
              try { await env.AI.run(id, { prompt: "agree" }); } catch (e2) { /* agree itself throws */ }
              out = await env.AI.run(id, { messages: messages, max_tokens: 500 });
            } else throw err;
          }
        }
        const reply = (out && (out.response || out.description || out.answer)) || "";
        if (!reply) return json({ ok: false, err: ["model rỗng", JSON.stringify(out).slice(0, 240)] }, 502);
        return json({ ok: true, reply: String(reply).slice(0, 4000), model: who });
      }
      if (path === "/api/advise" && req.method === "POST") {
        const body = await readBody(req);
        const pack = await getPack(env);
        const snap = snapshotFrom({
          tf: body.tf,
          fx: body.fx,
          lastBar: body.lastBar,
          chartReads: body.chartReads,
          marks: body.marks,
          notes: pack.days || []
        });
        const text = await askClaude(env.ANTHROPIC_API_KEY, snap, body.images);
        const pathDraw = parsePath(text);
        pack.lastAdvise = pathDraw.note || text;
        const next = await putPack(env, pack);
        return json({ ok: true, advise: pathDraw.note || text, path: pathDraw, notes: next.notes, at: next.at });
      }
      return json({ ok: false, err: ["not found"] }, 404);
    } catch (e) {
      return json({ ok: false, err: [String(e && e.message || e), String(e && e.stack || "").split("\n")[0]] }, 502);
    }
  }
};
