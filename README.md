# XAUUSD Desk

Realtime gold desk. Not a broker. Calls are EMA / RSI / ATR rules, not orders.

## Local

```
node server.mjs
```

Open http://127.0.0.1:4180/

Tick = Swissquote XAU/USD mid (fallback MT5). Live candles = XAUUSD MT5. History = COMEX GC=F: 1D/1W from 2020; 1h/4h ~2 years; 5m/15m ~1 month.

## Notes + Advise

Type a daily note on the page → **Lưu note**. **Advise** sends notes + the current EMA/RSI/ATR call to Claude. Not a broker.

Local: notes file `private/notes.json` (gitignored). Needs `ANTHROPIC_API_KEY` in the shell for Advise.

Live Worker: bind KV `NOTES`, then `npx wrangler secret put ANTHROPIC_API_KEY --config wrangler.toml`. Pages cannot hold the key.

## Live

GitHub Pages serves `index.html`. FX pipe is a Cloudflare Worker (`worker.js`) because the browser cannot call Swissquote / biquote (no CORS).
