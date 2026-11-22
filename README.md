# TRADEOS — AI-Powered Trading Intelligence

A mobile-first trading journal and performance-analytics platform for Zerodha traders.
TRADEOS imports executed fills, reconstructs round-trip trades, calculates realized P&L
with a deterministic engine, and reviews trades with evidence-based AI.

> **Analytics only.** TRADEOS never places, modifies or cancels orders. No order endpoint exists.

## Features

| Area | What's implemented |
|---|---|
| **Auth** | Built-in email + password (scrypt), server-side sessions (hashed tokens, HTTP-only cookies), TOTP two-factor (RFC 6238) enforced on every page and API, login lockout after 5 failures |
| **Zerodha (Mode A)** | Official Kite Connect login → server-side `request_token` exchange (SHA-256 checksum) → AES-256-GCM encrypted token, decrypted only on the server. Daily scheduled collection, manual sync, postback-triggered reconciliation, positions reconciliation, reconnect detection (`TokenException`, 06:00 IST expiry), secure disconnect |
| **Historical import (Mode B)** | Zerodha Console tradebook CSV + generic CSV; per-row validation; idempotent (re-imports insert nothing) |
| **Demo (Mode C)** | Deterministic synthetic dataset, clearly labelled and never written to your account |
| **P&L engine** | FIFO round-trip reconstruction: partial fills, scale-in/out, flips through zero, shorts, open positions; estimated vs verified charges; versioned (`fifo-v1`) |
| **Mission Control** | 16 metric cards, equity curve, weekly bars, P&L calendar, win/loss, strategy leaderboard, recent trades, insights, risk score, weekly summary; customizable and persisted widget layout |
| **Journal** | Auto-created per trade; rationale, stop/target, strategy, mistakes, emotion, confidence, tags, notes, screenshots; search and filters; auto vs user data visually separated |
| **Replay** | Lightweight Charts candle replay (1m/5m/15m/30m/1D); the server only sends candles up to the cursor (no future leakage); entry/exit markers, stop/target lines, unrealized P&L, decision notes |
| **Analytics Lab** | Time (day/week/month/weekday/hour/session), instruments, strategy (incl. consistency), behavior (evidence-gated), 9 chart types |
| **TRADEOS Intelligence** | Trade reviews split into verified facts / possible factors / missing info / improvements; accept, reject or correct each item |
| **TRADEOS Coach** | Tool-calling over your data (Groq); all numbers from deterministic tools; grounding check; source trade IDs and periods on every answer |
| **Risk Center** | Configurable limits, daily/weekly budgets, drawdown, risk per trade, concentration, transparent discipline score, informational alerts |
| **Weekly reports** | Calendar-week (never rolling) report in your timezone, PDF download, optional email (Resend) |
| **Notifications** | Trade closed/imported, daily loss exceeded, weekly report, broker disconnected, sync failed, missing journal, AI review ready — all from verified records |
| **Data quality** | Complete / partial / awaiting-verification status, import batches, reconciliation warnings |

## Calculation conventions (documented and tested)

- **Trade** = position goes flat → non-zero → flat for one exchange/symbol/product.
- **Outcome** uses **net** P&L; breakeven when `|net| < ₹1`.
- **Win rate** = wins ÷ (wins + losses) × 100. Breakevens are excluded from the denominator and shown separately (an "incl. BE" rate is also shown).
- **Profit factor** = Σ winning net ÷ |Σ losing net|; `null` with an explanation when there are no losses.
- **Expectancy** = P(win)·avgWin − P(loss)·avgLoss over all closed trades.
- **Reward/risk** only when a valid planned stop exists (stop on the correct side of entry).
- **Drawdown** = peak-to-trough on cumulative **realized** net P&L from starting capital. Mark-to-market is never mixed in.
- **Charges**: estimated from `src/lib/engine/fees.ts` (brokerage per order, STT, exchange txn, SEBI, GST, stamp, DP). Always labelled *Estimated* unless verified costs are supplied.
- A SELL that opens a cash-equity position for CNC (or for UNKNOWN not covered the same day) is treated as a sale of pre-import holdings. It is reported as a warning, never turned into an invented trade.

## File structure

```
src/
  app/
    (app)/            overview, journal, journal/trade (?key=), analytics, replay, intelligence,
                      risk, reports, broker, data-quality, settings
    api/              broker/zerodha/{login,callback,sync,disconnect,postback}, cron/sync,
                      import/csv, journal(+attachments), reviews/[key], coach, market/candles,
                      reports/weekly, risk, preferences, notifications, demo
    login/, login/mfa, auth/callback
  components/         ui primitives, shell (sidebar, bottom dock, top bar), charts, dashboard,
                      journal, intelligence, replay, risk, broker, reports, settings
  lib/
    engine/           types, time (IST), fees, reconstruct, metrics, risk, weekly  ← deterministic core
    kite/             read-only Kite client (allowlist), normalize, sync
    ai/               groq, grounding, review(+Service), coach(+Service)
    auth/             password (scrypt), session (cookies), totp (RFC 6238)
    db.ts             Neon serverless client
    data/             workspace (demo/live), pipeline (ingest, atomic rebuild), mappers, range
    import/csv.ts     tradebook parser
    security/crypto.ts AES-256-GCM, checksums, log redaction
  middleware.ts       session refresh, auth gate, MFA, rate limit, CSRF origin check
db/schema.sql         Neon schema
tests/                vitest suites + fixtures       e2e/smoke.mjs (demo) · e2e/live.mjs (real DB, two users, MFA)
```

## Database setup (Neon)

The database is a Neon Postgres project named **tradeos** (`round-poetry-43359288`, AWS Singapore). It contains 25 tables: the 22 required tables, plus `users`, `sessions` and `broker_secrets`. The app talks to it over HTTPS with `@neondatabase/serverless`.

To recreate the schema on a new database, run `db/schema.sql` once (Neon SQL editor or `psql "$DATABASE_URL" -f db/schema.sql`).

Data isolation is enforced in application code: every query on user-owned tables filters by the authenticated user's id. `e2e/live.mjs` verifies that a second user cannot read or modify the first user's trades, journal, reviews or candles. Screenshots are stored in Postgres (`journal_attachments.data`, max 5 MB, image type verified by magic bytes).

## Environment variables

See `.env.example`.

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Neon → project → Connect (pooled connection string). Server only |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` (encrypts Kite tokens and TOTP secrets) |
| `KITE_API_KEY`, `KITE_API_SECRET` | developers.kite.trade app |
| `CRON_SECRET` | any long random string |
| `GROQ_API_KEY` (optional), `GROQ_MODEL` | console.groq.com. Without a key, the AI uses deterministic summaries |
| `RESEND_API_KEY`, `REPORT_FROM_EMAIL` (optional) | resend.com for weekly emails |
| `NEXT_PUBLIC_APP_URL` | your deployed URL |

Without `DATABASE_URL`, the app runs in demo-only mode.

## Zerodha Kite Connect configuration

1. Create an app at <https://developers.kite.trade> (Connect plan). Historical candles for replay need the historical-data add-on.
2. **Redirect URL**: `https://<your-domain>/api/broker/zerodha/callback`
3. **Postback URL** (optional): `https://<your-domain>/api/broker/zerodha/postback`
4. Put the API key and secret in the server env. Sign in to TRADEOS → **Broker Connections** → **Connect Zerodha**.
5. Kite logs you out daily (~06:00 IST). The app shows *Reconnection required*, and you reconnect through the official login. OTP is never automated.
6. Kite's `/orders` and `/trades` only cover **today**, so the daily cron (16:45 IST, Mon–Fri, `vercel.json`) is what builds history. Import Console tradebooks for older trades.

Kite has no read-only scope, so `src/lib/kite/client.ts` enforces an endpoint allowlist, and tests assert that order endpoints are blocked.

## Run locally

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Checks:

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run build
```

E2E smoke test (with the app running; needs `npm i -D playwright && npx playwright install chromium` outside this environment):

```bash
BASE_URL=http://localhost:3000 npm run e2e
```

## Deploy (Render) — current deployment

Live service: **https://tradeos-4ie7.onrender.com** (Render web service `tradeos`, Singapore, free plan, auto-deploys from `claude/tradeos-trading-platform-ug65tp`).

- Build: `npm ci --include=dev && npm run build` · Start: `npx next start -H 0.0.0.0 -p $PORT`
- Set on Render: `NODE_VERSION`, `NEXT_PUBLIC_APP_URL`, `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `GROQ_MODEL`
- Add in the Render dashboard (Environment): `KITE_API_KEY`, `KITE_API_SECRET`, `GROQ_API_KEY`, optional `RESEND_API_KEY` / `REPORT_FROM_EMAIL`. `NEXT_PUBLIC_*` changes need a rebuild.
- Daily collection: `.github/workflows/daily-sync.yml` calls `/api/cron/sync` (needs repo secret `TRADEOS_CRON_SECRET` + variable `TRADEOS_URL`; scheduled workflows only run from the default branch). A Render Cron Job running `curl` is a paid alternative.
- Free instances sleep after ~15 min idle; the first request after that takes up to a minute.

## Deploy (Vercel)

1. Import the repo in Vercel and add all env vars (Production + Preview). Set `NEXT_PUBLIC_APP_URL` to the production URL.
2. Deploy. `vercel.json` registers the cron, and Vercel sends `Authorization: Bearer $CRON_SECRET`.
3. Update the Kite redirect/postback URLs to the production domain.
4. Backups: Neon keeps point-in-time history (6 h on the free plan; raise it on paid plans). Raw executions are preserved, so analytics can always be rebuilt.

## Security summary

Server-only broker operations · AES-256-GCM encryption of Kite tokens and TOTP secrets · scrypt password hashing · hashed session tokens in HTTP-only, SameSite cookies · TOTP MFA enforced server-side · login lockout and auth rate limits · per-user query scoping (tested with two users) · CSRF origin check · zod input validation · audit log · log redaction · CSP/HSTS/frame-deny headers · secure disconnect (token invalidated and deleted) · no order endpoints. Run `npm audit` for dependency scanning.

## Known limitations

- **The live Zerodha integration has not been tested with real credentials.** The token exchange, sync and postback logic are covered by unit tests with mocked responses only.
- Charges are estimates. There's no contract-note importer yet to fill `verified_costs`.
- Console tradebooks have no product type: same-day round trips are treated as intraday, multi-day as delivery.
- Corporate actions (splits, bonuses) are not adjusted.
- Unrealized P&L for open positions isn't shown (no live price feed).
- No email verification or password-reset email yet (there's no email provider wired to auth). Password reset needs an admin for now.
- Rate limiting is in-memory per instance. Use a shared store (e.g. Upstash) for strict limits.
- Replay decision notes are stored in the browser (localStorage). Demo journal edits are browser-only by design.
- In serverless environments, AI reviews are generated on first view (and queued as `pending` at sync time). There's no separate worker.
- Historical candles need the Kite historical-data add-on. Without it, replay explains why candles are unavailable instead of inventing them.
- `npm audit` flags `postcss` bundled inside Next.js 15 (build-time CSS tooling, 1 high + 1 moderate). The fix needs a major Next.js upgrade, so it is not forced here.
