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
    return clampNote(n && n.text);
  }).filter(Boolean);
  return {
    tf: tf,
    fx: fx,
    side: d.side || "WAIT",
    title: d.title || "",
    lead: d.lead || "",
    why: Array.isArray(d.why) ? d.why.slice(0, 8) : [],
    lvls: d.lvls || null,
    notes: lastN
  };
}

export function systemPrompt() {
  return [
    "You are a gold-desk coach for XAUUSD, not a broker.",
    "Read the user's daily notes plus the current EMA/RSI/ATR call.",
    "Reply in Vietnamese, short, concrete. 6–10 lines max.",
    "Do not place or imply a live order. Say nhận định, not lệnh sàn.",
    "If notes conflict with the rule call, name the conflict.",
    "If data is thin, say WAIT. Never invent a price."
  ].join(" ");
}

export function userPrompt(snap) {
  const lv = snap.lvls
    ? ("Entry " + snap.lvls.entry + " · SL " + snap.lvls.sl + " · TP1 " + snap.lvls.tp1 + " · TP2 " + snap.lvls.tp2)
    : "no levels";
  const notes = snap.notes.length
    ? snap.notes.map(function (n, i) { return (i + 1) + ". " + n; }).join("\n")
    : "(no notes yet)";
  return [
    "Khung: " + snap.tf,
    "FX mid: " + (snap.fx == null ? "—" : snap.fx),
    "Rule call: " + snap.side + " — " + snap.title,
    snap.lead,
    "Why: " + (snap.why.join(" | ") || "—"),
    "Levels: " + lv,
    "",
    "Daily notes (oldest → newest):",
    notes,
    "",
    "Advise for the next session. Keep it a coach note, not an order."
  ].join("\n");
}

export async function askClaude(apiKey, snap) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: systemPrompt(),
      messages: [{ role: "user", content: userPrompt(snap) }]
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
