const UA = "xauusd-desk/1.0";
const FROM_2020 = Math.floor(Date.UTC(2020, 0, 1) / 1000);
const cache = { tick: Object.create(null), tickAt: Object.create(null), bars: Object.create(null), barsAt: Object.create(null) };

export const SYMS = {
  XAUUSD: { id: "XAUUSD", label: "XAUUSD", swiss: ["XAU", "USD"], biquote: "XAUUSD", yahoo: "GC=F", binance: null },
  BTCUSD: { id: "BTCUSD", label: "BTC/USD", swiss: null, biquote: null, yahoo: "BTC-USD", binance: "BTCUSDT" },
  USOIL: { id: "USOIL", label: "USOil", swiss: ["WTI", "USD"], biquote: null, yahoo: "CL=F", binance: null }
};

export function jsonHeaders() {
  return {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store"
  };
}

function specOf(sym) {
  return SYMS[sym] || SYMS.XAUUSD;
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

export async function fetchTick(sym) {
  const spec = specOf(sym);
  const ck = spec.id;
  if (cache.tick[ck] && Date.now() - (cache.tickAt[ck] || 0) < 2000) return cache.tick[ck];
  const err = [];
  let fx = null;

  if (spec.swiss) {
    try {
      const j = await getJson("https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/" + spec.swiss[0] + "/" + spec.swiss[1]);
      fx = swissMid(j);
    } catch (e) {
      err.push("swiss " + (e.message || e));
    }
  }

  if (!fx && spec.biquote) {
    try {
      const j = await getJson("https://biquote.io/api/" + spec.biquote);
      const bid = Number(j.bid);
      const ask = Number(j.ask);
      const mid = Number(j.mid) || ((bid + ask) / 2);
      if (!isFinite(mid)) throw new Error("empty");
      fx = { bid: bid, ask: ask, mid: mid, ts: Date.parse(j.timestamp) || Date.now(), source: j.source || "biquote-mt5" };
    } catch (e) {
      err.push("mt5 " + (e.message || e));
    }
  }

  if (!fx && spec.binance) {
    try {
      const j = await getJson("https://api.binance.com/api/v3/ticker/price?symbol=" + spec.binance);
      const n = Number(j.price);
      if (!isFinite(n)) throw new Error("empty");
      fx = { bid: n, ask: n, mid: n, ts: Date.now(), source: "binance" };
    } catch (e) {
      err.push("binance " + (e.message || e));
    }
  }

  let paxg = null;
  let spot = null;
  if (spec.id === "XAUUSD") {
    try {
      const j = await getJson("https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT");
      const n = Number(j.price);
      if (isFinite(n)) paxg = n;
    } catch (e) {
      err.push("paxg " + (e.message || e));
    }
    try {
      const j = await getJson("https://api.gold-api.com/price/XAU");
      const n = Number(j.price);
      if (isFinite(n)) spot = n;
    } catch (e) {
      err.push("spot " + (e.message || e));
    }
  }

  if (!fx) {
    try {
      const bars = await fetchYahooRange(spec.yahoo, "1d", "5d");
      const last = bars[bars.length - 1];
      if (last) fx = { bid: last.c, ask: last.c, mid: last.c, ts: last.t, source: "yahoo" };
    } catch (e) {
      err.push("yahoo " + (e.message || e));
    }
  }

  const out = {
    ok: !!(fx && isFinite(fx.mid)),
    fx: fx,
    paxg: paxg,
    spot: spot,
    sym: spec.id,
    err: err,
    at: Date.now()
  };
  cache.tick[ck] = out;
  cache.tickAt[ck] = Date.now();
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

async function fetchYahooRange(ticker, interval, range) {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + ticker + "?interval=" +
    interval + "&range=" + range;
  const j = await getJson(url, 25000);
  return yahooBars(j);
}

async function fetchYahooFrom(ticker, interval, period1) {
  const now = Math.floor(Date.now() / 1000);
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + ticker + "?interval=" +
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

function binanceIv(key) {
  if (key === "1w") return "1w";
  if (key === "1d") return "1d";
  if (key === "4h") return "4h";
  if (key === "1h") return "1h";
  if (key === "5m") return "5m";
  return "15m";
}

async function fetchBinance(symbol, key, limit) {
  const j = await getJson(
    "https://api.binance.com/api/v3/klines?symbol=" + symbol + "&interval=" + binanceIv(key) + "&limit=" + (limit || 500),
    15000
  );
  if (!Array.isArray(j)) return [];
  return j.map(function (k) {
    return { t: Number(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4] };
  }).filter(function (b) {
    return isFinite(b.t) && b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0 && b.h >= b.l;
  });
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

async function fetchHist(spec, key) {
  const y = spec.yahoo;
  if (key === "5m") return { bars: await fetchYahooRange(y, "5m", "1mo"), note: y + " 5m ~1 tháng" };
  if (key === "15m") return { bars: await fetchYahooRange(y, "15m", "1mo"), note: y + " 15m ~1 tháng" };
  const daily = await fetchYahooFrom(y, "1d", FROM_2020);
  if (key === "1d") return { bars: daily, note: y + " 1D từ 2020" };
  if (key === "1w") {
    let weekly = [];
    try { weekly = await fetchYahooFrom(y, "1wk", FROM_2020); } catch (e) { weekly = []; }
    if (weekly.length < 50) weekly = weeklyFromDaily(daily);
    return { bars: weekly, note: y + " 1W từ 2020" };
  }
  if (key === "1h") {
    const h = await fetchYahooRange(y, "1h", "730d");
    return { bars: mergeNoShift(daily, h), note: y + " 1h ~2 năm + 1D từ 2020" };
  }
  if (key === "4h") {
    let h4 = [];
    try { h4 = await fetchYahooRange(y, "4h", "730d"); } catch (e) { h4 = []; }
    if (!h4.length) {
      const h = await fetchYahooRange(y, "1h", "730d");
      h4 = weeklyLike(h, 4 * 3600 * 1000);
    }
    return { bars: mergeNoShift(daily, h4), note: y + " 4h ~2 năm + 1D từ 2020" };
  }
  return { bars: daily, note: y + " 1D từ 2020" };
}

export async function fetchBars(interval, sym) {
  const spec = specOf(sym);
  const key = interval === "1w" ? "1w" : interval;
  const ck = spec.id + ":" + key;
  if (cache.bars[ck] && Date.now() - (cache.barsAt[ck] || 0) < 20000) return cache.bars[ck];

  let live = [];
  let hist = [];
  let note = "";
  let liveErr = "";
  let histErr = "";

  try {
    if (spec.binance) live = await fetchBinance(spec.binance, key, 500);
    else if (spec.biquote) {
      if (key === "1w") live = weeklyFromDaily(await fetchBiquote("1d", 800));
      else live = await fetchBiquote(key, 500);
    }
  } catch (e) {
    liveErr = String(e.message || e);
  }

  try {
    const h = await fetchHist(spec, key);
    hist = h.bars;
    note = h.note;
  } catch (e) {
    histErr = String(e.message || e);
  }

  const bars = stitch(hist, live);
  const source = [
    note,
    live.length ? (spec.binance ? " + Binance live" : " + MT5 live") : "",
    histErr ? " · yahoo " + histErr : "",
    liveErr ? " · live " + liveErr : ""
  ].join("");

  const out = {
    ok: bars.length > 0,
    interval: key,
    sym: spec.id,
    bars: bars,
    source: source,
    n: bars.length,
    hist: hist.length,
    live: live.length,
    at: Date.now()
  };
  cache.bars[ck] = out;
  cache.barsAt[ck] = Date.now();
  return out;
}

export const ALLOWED = { "5m": 1, "15m": 1, "1h": 1, "4h": 1, "1d": 1, "1w": 1 };
