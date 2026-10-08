const MODEL = "claude-sonnet-4-6";
const MAX_NOTES = 80;

export function clampNote(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 800);
}

export function snapshotFrom(body) {
  const d = body && body.decide ? body.decide : {};
  const fx = body && body.fx != null ? body.fx : null;
  const tf = String((body && body.tf) || "15m");
  const notes = Array.isArray(body && body.notes) ? body.notes : [];
  const lastN = notes.slice(-MAX_NOTES).map(function (n) {
    if (typeof n === "string") return clampNote(n);
    if (n && n.day) {
      var line = n.day + " · " + clampNote(n.text);
      (n.trades || []).forEach(function (tr) {
        line += " | " + tr.side + " in " + tr.entry + (tr.tp != null ? " TP " + tr.tp : "") + (tr.sl != null ? " cut " + tr.sl : "");
      });
      return line;
    }
    return clampNote(n && n.text);
  }).filter(Boolean);
  const last = body && body.lastBar ? body.lastBar : null;
  return {
    tf: tf,
    fx: fx,
    lastBar: last,
    notes: lastN,
    chartReads: Array.isArray(body && body.chartReads) ? body.chartReads.slice(-12) : [],
    marks: Array.isArray(body && body.marks) ? body.marks.slice(0, 40) : []
  };
}

export function systemPrompt() {
  return [
    "You summarize the user's own chart marks and HIS trade book on XAUUSD. You are not a broker.",
    "Input marks are HIS lines: HLine = level, Line = trend, Fib = his swing.",
    "Trade book lines are HIS: side, entry, TP, cut. Remember that style when advising: typical TP/cut distance, BUY vs SELL bias.",
    "Every entry idea must include WHY in the note (level, reject, hold) — never a price with no reason.",
    "Do not invent new RSI/EMA/ATR. Do not contradict a level he already drew unless the live price has already broken it.",
    "Reply with JSON only, no markdown. Shape:",
    '{"bias":"up|down|range","path":[],"hlines":[],"fib":null,"note":"vietnamese 4-8 lines"}',
    "path and hlines stay EMPTY unless he drew nothing — then you may propose. Prefer note-only summary of HIS marks.",
    "Never invent a live order."
  ].join(" ");
}

export function userPrompt(snap) {
  const last = snap.lastBar
    ? ("Last candle H " + snap.lastBar.h + " L " + snap.lastBar.l + " C " + snap.lastBar.c)
    : "no last candle";
  const notes = snap.notes.length
    ? snap.notes.map(function (n, i) { return (i + 1) + ". " + n; }).join("\n")
    : "(no notes yet)";
  const reads = snap.chartReads.length
    ? snap.chartReads.join("\n")
    : "(no chart-photo reads yet)";
  const marks = (snap.marks || []).length
    ? snap.marks.map(function (m, i) { return (i + 1) + ". " + JSON.stringify(m); }).join("\n")
    : "(he has not drawn Line / HLine / Fib on the desk)";
  return [
    "Khung: " + snap.tf,
    "FX mid: " + (snap.fx == null ? "—" : snap.fx),
    last,
    "",
    "HIS chart marks (source of truth):",
    marks,
    "",
    "Reads from cao thủ chart photos:",
    reads,
    "",
    "Daily notes (oldest → newest):",
    notes,
    "",
    "Summarize HIS marks. JSON only. Leave path/hlines empty if he already drew."
  ].join("\n");
}

export function parsePath(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { note: raw.slice(0, 4000), path: [], hlines: [], fib: null, bias: "range" };
  try {
    const j = JSON.parse(raw.slice(start, end + 1));
    const path = Array.isArray(j.path) ? j.path.map(function (pt) {
      return { p: Number(pt.p), label: String(pt.label || "").slice(0, 40) };
    }).filter(function (pt) { return isFinite(pt.p); }).slice(0, 8) : [];
    const hlines = Array.isArray(j.hlines) ? j.hlines.map(Number).filter(isFinite).slice(0, 8) : [];
    let fib = null;
    if (j.fib && isFinite(j.fib.hi) && isFinite(j.fib.lo) && j.fib.hi !== j.fib.lo) {
      fib = { hi: Number(j.fib.hi), lo: Number(j.fib.lo) };
    }
    return {
      bias: /up|down|range/.test(String(j.bias || "")) ? String(j.bias) : "range",
      path: path,
      hlines: hlines,
      fib: fib,
      note: String(j.note || raw).slice(0, 4000)
    };
  } catch (e) {
    return { note: raw.slice(0, 4000), path: [], hlines: [], fib: null, bias: "range" };
  }
}

function imageBlocks(imgs) {
  if (!Array.isArray(imgs)) return [];
  return imgs.slice(-4).map(function (im) {
    var data = String((im && im.data) || "");
    var mime = String((im && im.mime) || "image/png");
    var m = data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (m) { mime = m[1]; data = m[2]; }
    if (!data) return null;
    return {
      type: "image",
      source: { type: "base64", media_type: mime, data: data }
    };
  }).filter(Boolean);
}

export async function askClaude(apiKey, snap, imgs) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  var content = imageBlocks(imgs);
  content.push({ type: "text", text: userPrompt(snap) });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: systemPrompt(),
      messages: [{ role: "user", content: content }]
    })
  });
  const j = await r.json();
  if (!r.ok) {
    const msg = (j && j.error && j.error.message) || ("HTTP " + r.status);
    throw new Error(msg);
  }
  const text = ((j.content || []).map(function (c) { return c.text || ""; }).join("\n")).trim();
  if (!text) throw new Error("empty model reply");
  return text.slice(0, 4000);
}
