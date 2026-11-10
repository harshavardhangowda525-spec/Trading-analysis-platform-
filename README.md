# TRADEOS — AI-Powered Trading Intelligence

A mobile-first trading journal and performance-analytics platform for Zerodha traders.
TRADEOS imports executed fills, reconstructs round-trip trades, calculates realized P&L
with a deterministic engine, and reviews trades with evidence-based AI.

> **Analytics only.** TRADEOS never places, modifies or cancels orders. No order endpoint exists.

## Features

| Area | What's implemented |
|---|---|
| **Auth** | Supabase Auth (email + password, magic link), TOTP MFA with AAL2 enforcement in middleware, HTTP-only session cookies |
| **Zerodha (Mode A)** | Official Kite Connect login → server-side `request_token` exchange (SHA-256 checksum) → AES-256-GCM encrypted token in a service-role-only table. Daily scheduled collection, manual sync, postback-triggered reconciliation, positions reconciliation, reconnect detection (`TokenException`, 06:00 IST expiry), secure disconnect |
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
    (app)/            overview, journal, journal/[key], analytics, replay, intelligence,
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
    data/             workspace (demo/live), pipeline (ingest, atomic rebuild), mappers, range
    import/csv.ts     tradebook parser
    security/crypto.ts AES-256-GCM, checksums, log redaction
  middleware.ts       session refresh, auth gate, MFA, rate limit, CSRF origin check
supabase/migrations/  schema, RLS, storage, rebuild function, hardening
supabase/tests/rls.sql RLS verification (rolls back)
tests/                vitest suites + fixtures       e2e/smoke.mjs  Playwright smoke test
```

## Database setup

A Supabase project named **tradeos** (`undmatkjencmymgmncdp`, region ap-south-1) was created and migrations `…0001_init` and `…0002_rebuild_fn` were applied. To set up another project, run every file in `supabase/migrations/` in order: `supabase db push`, or paste them into the SQL editor.

It creates 23 tables (the 22 required plus `broker_secrets`), with UUID keys, foreign keys, indexes and RLS on every table. It also adds private storage buckets (`journal-attachments`, `reports`) scoped to `<user_id>/…`, and the atomic `rebuild_analytics` function. Verify RLS with `supabase/tests/rls.sql`.

In Supabase → Authentication → URL configuration, add `<APP_URL>/auth/callback` to the redirect URLs.

## Environment variables

See `.env.example`. Required for live mode:

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page (secret). Server only; used for broker tokens, sync and audit logs |
| `KITE_API_KEY`, `KITE_API_SECRET` | developers.kite.trade app |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `CRON_SECRET` | any long random string |
| `GROQ_API_KEY` (optional), `GROQ_MODEL` | console.groq.com. Without a key, the AI uses deterministic summaries |
| `RESEND_API_KEY`, `REPORT_FROM_EMAIL` (optional) | resend.com for weekly emails |
| `NEXT_PUBLIC_APP_URL` | your deployed URL |

Without Supabase variables, the app runs in demo-only mode.

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

## Deploy (Vercel)

1. Import the repo in Vercel and add all env vars (Production + Preview). Set `NEXT_PUBLIC_APP_URL` to the production URL.
2. Deploy. `vercel.json` registers the cron, and Vercel sends `Authorization: Bearer $CRON_SECRET`.
3. Update the Kite redirect/postback URLs and the Supabase auth redirect URL to the production domain.
4. Backups: enable Supabase PITR or daily backups. Raw executions are preserved, so analytics can always be rebuilt (`rebuild_analytics`).

## Security summary

Server-only broker operations · AES-256-GCM token encryption · service-role-only secret table · RLS on all tables (verified) · MFA (TOTP, AAL2 enforced) · HTTP-only cookies · CSRF origin check · rate limiting · zod input validation · audit log (service role) · log redaction · CSP/HSTS/frame-deny headers · secure disconnect (token invalidated + deleted) · no order endpoints. Run `npm audit` for dependency scanning.

## Known limitations

- **The live Zerodha integration has not been tested with real credentials.** The token exchange, sync and postback logic are covered by unit tests with mocked responses only.
- Charges are estimates. There's no contract-note importer yet to fill `verified_costs`.
- Console tradebooks have no product type: same-day round trips are treated as intraday, multi-day as delivery.
- Corporate actions (splits, bonuses) are not adjusted.
- Unrealized P&L for open positions isn't shown (no live price feed).
- Rate limiting is in-memory per instance. Use a shared store (e.g. Upstash) for strict limits.
- Replay decision notes are stored in the browser (localStorage). Demo journal edits are browser-only by design.
- In serverless environments, AI reviews are generated on first view (and queued as `pending` at sync time). There's no separate worker.
- Historical candles need the Kite historical-data add-on. Without it, replay explains why candles are unavailable instead of inventing them.
- `npm audit` flags `postcss` bundled inside Next.js 15 (build-time CSS tooling, 1 high + 1 moderate). The fix needs a major Next.js upgrade, so it is not forced here.
