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
        if (!say && !img) return json({ ok: false, err: ["empty"] }, 400);
        if (img && img.length > 1800000) return json({ ok: false, err: ["ảnh quá nặng, chụp lại nhỏ hơn"] }, 400);
        const hist = Array.isArray(body.history) ? body.history.slice(-8) : [];
        const messages = [{
          role: "system",
          content: "Bạn nói tiếng Việt, ngắn, như người xem chart vàng với Philip. Anh ấy gửi ảnh line/fib/khung của cao thủ. Mô tả đúng những gì thấy: hướng line, vùng giá nếu đọc được, fib, khung. Không bịa giá không có trên ảnh. Không phải lệnh sàn, không bảo anh ấy all-in. Nếu ảnh mờ thì nói mờ."
        }];
        hist.forEach(function (m) {
          if (!m || (m.role !== "user" && m.role !== "assistant")) return;
          const c = String(m.content || "").trim().slice(0, 800);
          if (c) messages.push({ role: m.role, content: c });
        });
        const user = { role: "user", content: say || "Đọc ảnh chart này. Kẻ gì, hướng nào, vùng giá nào đọc được." };
        if (img.indexOf("base64,") > 0) {
          const bytes = Uint8Array.from(atob(img.split("base64,")[1]), function (c) { return c.charCodeAt(0); });
          user.image = [...bytes];
        }
        messages.push(user);
        const out = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
          messages: messages,
          max_tokens: 500
        });
        const reply = (out && (out.response || out.description)) || "";
        if (!reply) return json({ ok: false, err: ["model rỗng"] }, 502);
        return json({ ok: true, reply: String(reply).slice(0, 4000) });
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
      return json({ ok: false, err: [String(e.message || e)] }, 502);
    }
  }
};
