# XAUUSD Desk

Realtime gold desk. Not a broker. Calls are EMA / RSI / ATR rules, not orders.

## Local

```
node server.mjs
```

Open http://127.0.0.1:4180/

Tick = Swissquote XAU/USD mid (fallback MT5). Live candles = XAUUSD MT5. History = COMEX GC=F: 1D/1W from 2020; 1h/4h ~2 years; 5m/15m ~1 month.

## Nhật ký + Tóm nét

Pick a day, write, drop chart photos, fill BUY/SELL · entry · TP · cut, **Submit**. Diary lives on the FX pipe KV — **not in git**. Photos on github.io currently do not persist (KV size); text + trades do.

**Tóm nét** summarizes HIS Line/HLine/Fib + the trade book. No RSI.

**Ví dụ vào lệnh** loads `playbook.json` (in git) and draws levels. 8 Oct lock: XAU sell 4200 TP 4123/4000 cut 10–15 while under 4250; buy only if stable above 4250 TP 4400. USOil buy 87–88 / resist 102. Not a copy of the cao thủ screenshot. Not a broker.

Local: `private/notes.json` (gitignored). Live Worker has KV `NOTES` + `ANTHROPIC_API_KEY` secret.

## Live

GitHub Pages serves `index.html`. FX pipe is a Cloudflare Worker (`worker.js`) because the browser cannot call Swissquote / biquote (no CORS).
