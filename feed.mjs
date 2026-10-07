const UA = "xauusd-desk/1.0";
const FROM_2020 = Math.floor(Date.UTC(2020, 0, 1) / 1000);
const cache = { tick: null, tickAt: 0, bars: Object.create(null), barsAt: Object.create(null) };

export function jsonHeaders() {
  return {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store"
  };
}

async function getJson(url, timeout) {
  timeout = timeout || 18000;
  const ac = new AbortController();
  const t = setTimeout(function () { ac.abort(); }, timeout);
  try {
    const r = await fetch(url, {
      cache: "no-store",
      signal: ac.signal,
      headers: { "user-agent": UA, accept: "application/json" }
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function swissMid(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const first = arr[0];
  const prices = first.spreadProfilePrices || [];
  const elite = prices.find(function (p) { return p.spreadProfile === "elite"; }) || prices[0];
  if (!elite) return null;
  const bid = Number(elite.bid);
  const ask = Number(elite.ask);
  if (!isFinite(bid) || !isFinite(ask)) return null;
  return {
    bid: bid,
    ask: ask,
    mid: (bid + ask) / 2,
    ts: Number(first.ts) || Date.now(),
    source: "swissquote"
  };
}

export async function fetchTick() {
  if (cache.tick && Date.now() - cache.tickAt < 2000) return cache.tick;
  const err = [];
  let fx = null;

  try {
    const j = await getJson("https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD");
    fx = swissMid(j);
  } catch (e) {
    err.push("swiss " + (e.message || e));
  }

  if (!fx) {
    try {
      const j = await getJson("https://biquote.io/api/XAUUSD");
      const bid = Number(j.bid);
      const ask = Number(j.ask);
      const mid = Number(j.mid) || ((bid + ask) / 2);
      if (!isFinite(mid)) throw new Error("empty");
      fx = {
        bid: bid,
        ask: ask,
        mid: mid,
        ts: Date.parse(j.timestamp) || Date.now(),
        source: j.source || "biquote-mt5"
      };
    } catch (e) {
      err.push("mt5 " + (e.message || e));
    }
  }

  let paxg = null;
  try {
    const j = await getJson("https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT");
    const n = Number(j.price);
    if (isFinite(n)) paxg = n;
  } catch (e) {
    err.push("paxg " + (e.message || e));
  }

  let spot = null;
  try {
    const j = await getJson("https://api.gold-api.com/price/XAU");
    const n = Number(j.price);
    if (isFinite(n)) spot = n;
  } catch (e) {
    err.push("spot " + (e.message || e));
  }

  const out = {
    ok: !!(fx && isFinite(fx.mid)),
    fx: fx,
    paxg: paxg,
    spot: spot,
    err: err,
    at: Date.now()
  };
  cache.tick = out;
  cache.tickAt = Date.now();
  return out;
}

function toBars(raw) {
  const list = (raw && raw.bars) || [];
  const bars = list.map(function (b) {
    return {
      t: Date.parse(b.openTime),
      o: +b.open,
      h: +b.high,
      l: +b.low,
      c: +b.close
    };
  }).filter(function (b) {
    return isFinite(b.t) && b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0 && b.h >= b.l;
  });
  bars.sort(function (a, b) { return a.t - b.t; });
  return bars;
}

function yahooBars(j) {
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.timestamp) return [];
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const out = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    const o = Number(q.open && q.open[i]);
    const h = Number(q.high && q.high[i]);
    const l = Number(q.low && q.low[i]);
    const c = Number(q.close && q.close[i]);
    if (!(o > 0) || !(h > 0) || !(l > 0) || !(c > 0) || h < l) continue;
    out.push({ t: res.timestamp[i] * 1000, o: o, h: h, l: l, c: c });
  }
  return out;
}

function stitch(hist, live) {
  if (!live.length) return hist;
  if (!hist.length) return live.slice();
  const start = live[0].t;
  const older = hist.filter(function (b) { return b.t < start; });
  if (!older.length) return live.slice();
  const lastH = older[older.length - 1];
  const off = live[0].o - lastH.c;
  const shifted = older.map(function (b) {
    return { t: b.t, o: b.o + off, h: b.h + off, l: b.l + off, c: b.c + off };
  });
  return shifted.concat(live);
}

function mergeNoShift(older, newer) {
  if (!newer.length) return older;
  if (!older.length) return newer.slice();
  const start = newer[0].t;
  return older.filter(function (b) { return b.t < start; }).concat(newer);
}

async function fetchYahooRange(interval, range) {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=" +
    interval + "&range=" + range;
  const j = await getJson(url, 25000);
  return yahooBars(j);
}

async function fetchYahooFrom(interval, period1) {
  const now = Math.floor(Date.now() / 1000);
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=" +
    interval + "&period1=" + period1 + "&period2=" + now;
  const j = await getJson(url, 25000);
  return yahooBars(j);
}

async function fetchBiquote(interval, limit) {
  const j = await getJson(
    "https://biquote.io/api/XAUUSD/ohlc?interval=" + interval + "&limit=" + (limit || 500),
    15000
  );
  return toBars(j);
}

function weekMondayUtc(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

function weeklyFromDaily(daily) {
  const map = new Map();
  for (let i = 0; i < daily.length; i++) {
    const b = daily[i];
    const k = weekMondayUtc(b.t);
    if (!map.has(k)) {
      map.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c });
    } else {
      const w = map.get(k);
      w.h = Math.max(w.h, b.h);
      w.l = Math.min(w.l, b.l);
      w.c = b.c;
    }
  }
  return Array.from(map.values()).sort(function (a, b) { return a.t - b.t; });
}

async function fetchHist(key) {
  if (key === "5m") {
    return { bars: await fetchYahooRange("5m", "1mo"), note: "COMEX 5m ~1 tháng" };
  }
  if (key === "15m") {
    return { bars: await fetchYahooRange("15m", "1mo"), note: "COMEX 15m ~1 tháng" };
  }
  const daily = await fetchYahooFrom("1d", FROM_2020);
  if (key === "1d") return { bars: daily, note: "COMEX 1D từ 2020" };
  if (key === "1w") {
    let weekly = [];
    try { weekly = await fetchYahooFrom("1wk", FROM_2020); } catch (e) { weekly = []; }
    if (weekly.length < 50) weekly = weeklyFromDaily(daily);
    return { bars: weekly, note: "COMEX 1W từ 2020" };
  }
  if (key === "1h") {
    const h = await fetchYahooRange("1h", "730d");
    return { bars: mergeNoShift(daily, h), note: "COMEX 1h ~2 năm + 1D từ 2020" };
  }
  if (key === "4h") {
    let h4 = [];
    try { h4 = await fetchYahooRange("4h", "730d"); } catch (e) { h4 = []; }
    if (!h4.length) {
      const h = await fetchYahooRange("1h", "730d");
      h4 = weeklyLike(h, 4 * 3600 * 1000);
    }
    return { bars: mergeNoShift(daily, h4), note: "COMEX 4h ~2 năm + 1D từ 2020" };
  }
  return { bars: daily, note: "COMEX 1D từ 2020" };
}

function weeklyLike(bars, ms) {
  const map = new Map();
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const k = Math.floor(b.t / ms) * ms;
    if (!map.has(k)) map.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c });
    else {
      const w = map.get(k);
      w.h = Math.max(w.h, b.h);
      w.l = Math.min(w.l, b.l);
      w.c = b.c;
    }
  }
  return Array.from(map.values()).sort(function (a, b) { return a.t - b.t; });
}

export async function fetchBars(interval) {
  const key = interval === "1w" ? "1w" : interval;
  if (cache.bars[key] && Date.now() - (cache.barsAt[key] || 0) < 20000) return cache.bars[key];

  let live = [];
  let hist = [];
  let note = "";
  let liveErr = "";
  let histErr = "";

  try {
    if (key === "1w") live = weeklyFromDaily(await fetchBiquote("1d", 800));
    else live = await fetchBiquote(key, 500);
  } catch (e) {
    liveErr = String(e.message || e);
  }

  try {
    const h = await fetchHist(key);
    hist = h.bars;
    note = h.note;
  } catch (e) {
    histErr = String(e.message || e);
  }

  const bars = stitch(hist, live);
  const source = [
    note,
    live.length ? " + MT5 live" : "",
    histErr ? " · yahoo " + histErr : "",
    liveErr ? " · mt5 " + liveErr : ""
  ].join("");

  const out = {
    ok: bars.length > 0,
    interval: key,
    bars: bars,
    source: source,
    n: bars.length,
    hist: hist.length,
    live: live.length,
    at: Date.now()
  };
  cache.bars[key] = out;
  cache.barsAt[key] = Date.now();
  return out;
}

export const ALLOWED = { "5m": 1, "15m": 1, "1h": 1, "4h": 1, "1d": 1, "1w": 1 };
