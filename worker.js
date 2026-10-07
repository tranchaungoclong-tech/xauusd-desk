import { fetchTick, fetchBars, ALLOWED, jsonHeaders } from "./feed.mjs";

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "*"
        }
      });
    }
    const u = new URL(req.url);
    try {
      if (u.pathname === "/api/tick" || u.pathname === "/tick") {
        const d = await fetchTick();
        return new Response(JSON.stringify(d), { status: d.ok ? 200 : 502, headers: jsonHeaders() });
      }
      if (u.pathname === "/api/klines" || u.pathname === "/klines") {
        const iv = u.searchParams.get("interval") || "15m";
        if (!ALLOWED[iv]) {
          return new Response(JSON.stringify({ ok: false, err: ["bad interval"] }), {
            status: 400,
            headers: jsonHeaders()
          });
        }
        const d = await fetchBars(iv);
        return new Response(JSON.stringify(d), { status: d.ok ? 200 : 502, headers: jsonHeaders() });
      }
      if (u.pathname === "/api/health" || u.pathname === "/health") {
        return new Response(JSON.stringify({ ok: true, pipe: "worker" }), {
          status: 200,
          headers: jsonHeaders()
        });
      }
      return new Response(JSON.stringify({ ok: false, err: ["not found"] }), {
        status: 404,
        headers: jsonHeaders()
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, err: [String(e.message || e)] }), {
        status: 502,
        headers: jsonHeaders()
      });
    }
  }
};
