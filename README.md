# XAUUSD Desk

Realtime gold desk. Not a broker. Calls are EMA / RSI / ATR rules, not orders.

## Local

```
node server.mjs
```

Open http://127.0.0.1:4180/

Tick = Swissquote XAU/USD mid (fallback MT5). Live candles = XAUUSD MT5. History = COMEX GC=F: 1D/1W from 2020; 1h/4h ~2 years; 5m/15m ~1 month.

## Live

GitHub Pages serves `index.html`. FX pipe is a Cloudflare Worker (`worker.js`) because the browser cannot call Swissquote / biquote (no CORS).
