// Live-mode end-to-end test against a real database (creates two throwaway users).
// Usage (app running with DATABASE_URL):  BASE_URL=http://localhost:3000 node e2e/live.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.env.BASE_URL ?? "http://localhost:3000";
const csv = readFileSync(new URL("../tests/fixtures/zerodha-tradebook.csv", import.meta.url), "utf8");
const stamp = Date.now();
const users = [`e2e-a-${stamp}@tradeos.test`, `e2e-b-${stamp}@tradeos.test`];
const password = "E2e-pass-2026x";

function totp(secretB32, t = Date.now()) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, v = 0; const out = [];
  for (const c of secretB32) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac("sha1", Buffer.from(out)).update(ctr).digest(); const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

const browser = await chromium.launch();
const step = async (n, f) => { await f(); console.log("✓", n); };
const ctxA = await browser.newContext(); const a = await ctxA.newPage();
const ctxB = await browser.newContext(); const b = await ctxB.newPage();
const api = (p, path, opts = {}) => p.evaluate(async ([path, opts]) => { const r = await fetch(path, opts); let body = null; try { body = await r.json(); } catch {} return { status: r.status, body }; }, [path, opts]);
const post = (p, path, data) => api(p, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const importCsv = (p) => p.evaluate(async (csv) => { const fd = new FormData(); fd.set("file", new File([csv], "tb.csv", { type: "text/csv" })); const r = await fetch("/api/import/csv", { method: "POST", body: fd }); return { status: r.status, body: await r.json() }; }, csv);

try {
  await step("signup A via UI lands on empty dashboard", async () => {
    await a.goto(`${base}/login`, { waitUntil: "networkidle" });
    await a.click("text=Create account");
    await a.fill("input[type=email]", users[0]); await a.fill("input[type=password]", password);
    await a.click("form button[type=submit]");
    await a.waitForSelector("text=No trades yet", { timeout: 60000 });
  });
  await step("weak password rejected", async () => {
    const r = await post(b, "/api/auth/signup", { email: "x@y.zz", password: "short" }).catch(() => null);
    // b has no page yet; use a
    const r2 = await post(a, "/api/auth/signup", { email: `weak-${stamp}@tradeos.test`, password: "short" });
    assert.equal(r2.status, 400); void r;
  });
  await step("getting-started checklist and Kite app setup → Connect goes to official Zerodha login", async () => {
    await a.goto(`${base}/`, { waitUntil: "networkidle" });
    await a.waitForSelector("text=Set up TRADEOS");
    assert.equal((await post(a, "/api/broker/zerodha/app", { apiKey: "bad key!", apiSecret: "x" })).status, 400);
    assert.equal((await post(a, "/api/broker/zerodha/app", { apiKey: "testkey1234abcd", apiSecret: "testsecret1234567890abcd" })).status, 200);
    const st = await api(a, "/api/broker/zerodha/app");
    assert.equal(st.body.configured, true);
    assert.ok(!JSON.stringify(st.body).includes("testsecret"), "secret must never be returned");
    const r = await a.request.get(`${base}/api/broker/zerodha/login`, { maxRedirects: 0 });
    const loc = r.headers()["location"] ?? "";
    assert.ok(loc.startsWith("https://kite.zerodha.com/connect/login"), loc);
    assert.ok(loc.includes("api_key=testkey1234abcd"));
    await a.goto(`${base}/broker`, { waitUntil: "networkidle" });
    await a.waitForSelector("text=Saved");
    await a.waitForSelector("text=Connect Zerodha");
  });
  await step("settings default timezone is Asia/Kolkata and health endpoint is up", async () => {
    await a.goto(`${base}/settings`, { waitUntil: "networkidle" });
    assert.equal(await a.locator(`select:has(option:text-is("Asia/Kolkata"))`).first().inputValue(), "Asia/Kolkata");
    assert.equal((await api(a, "/api/health")).status, 200);
  });
  let tradeKey;
  await step("A imports tradebook → trades persisted", async () => {
    const r = await importCsv(a);
    assert.equal(r.status, 200); assert.equal(r.body.inserted, 7); assert.equal(r.body.closedTrades, 2);
    await a.goto(`${base}/journal?range=all`, { waitUntil: "networkidle" });
    tradeKey = new URL(base + (await a.locator("table a").first().getAttribute("href"))).searchParams.get("key");
    assert.ok(tradeKey);
  });
  await step("re-import is idempotent", async () => {
    const r = await importCsv(a);
    assert.equal(r.body.inserted, 0); assert.equal(r.body.newTrades, 0);
  });
  await step("A saves journal + review is generated and stored", async () => {
    const r = await post(a, "/api/journal", { tradeKey, strategy: "ORB", entryRationale: "breakout", exitRationale: null, plannedStop: 1, plannedTarget: null, followedPlan: true, mistakes: ["FOMO entry"], lessons: null, emotionalState: "Calm", confidence: 3, tags: ["e2e"], notes: null });
    assert.equal(r.status, 200);
    const rv = await api(a, `/api/reviews/${encodeURIComponent(tradeKey)}`);
    assert.equal(rv.status, 200); assert.ok(rv.body.verifiedFacts.length > 0);
    await a.goto(`${base}/journal/trade?key=${encodeURIComponent(tradeKey)}`, { waitUntil: "networkidle" });
    await a.waitForSelector("text=Verified facts", { timeout: 30000 });
  });
  await step("user B is isolated from A's data", async () => {
    await b.goto(`${base}/login`, { waitUntil: "networkidle" });
    const s = await post(b, "/api/auth/signup", { email: users[1], password });
    assert.equal(s.status, 200);
    await b.goto(`${base}/journal?range=all`, { waitUntil: "networkidle" });
    assert.equal(await b.locator("table a").count(), 0);
    assert.equal((await api(b, `/api/reviews/${encodeURIComponent(tradeKey)}`)).status, 404);
    assert.equal((await post(b, "/api/journal", { tradeKey, strategy: null, entryRationale: "hijack", exitRationale: null, plannedStop: null, plannedTarget: null, followedPlan: null, mistakes: [], lessons: null, emotionalState: null, confidence: null, tags: [], notes: null })).status, 404);
    const c = await api(b, `/api/market/candles?trade=${encodeURIComponent(tradeKey)}&interval=15minute`);
    assert.equal(c.status, 404);
  });
  await step("MFA: enroll, then login requires a TOTP code", async () => {
    const en = await post(b, "/api/auth/mfa", { action: "enroll" });
    assert.equal(en.status, 200);
    assert.equal((await post(b, "/api/auth/mfa", { action: "confirm", code: totp(en.body.secret) })).status, 200);
    assert.equal((await post(b, "/api/auth/logout", {})).status, 200);
    const li = await post(b, "/api/auth/login", { email: users[1], password });
    assert.equal(li.body.mfaRequired, true);
    assert.equal((await api(b, "/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "win rate?" }) })).status, 401);
    await b.goto(`${base}/`, { waitUntil: "networkidle" });
    assert.ok(b.url().endsWith("/login/mfa"));
    assert.equal((await post(b, "/api/auth/mfa", { action: "verify", code: "000000" })).status, 401);
    assert.equal((await post(b, "/api/auth/mfa", { action: "verify", code: totp(en.body.secret) })).status, 200);
    await b.goto(`${base}/`, { waitUntil: "networkidle" });
    assert.ok(!b.url().includes("/login"));
  });
  await step("wrong password rejected; logout ends session", async () => {
    assert.equal((await post(a, "/api/auth/login", { email: users[0], password: "nope-nope-1" })).status, 401);
    assert.equal((await post(a, "/api/auth/logout", {})).status, 200);
    assert.equal((await api(a, "/api/import/csv", { method: "POST", body: new URLSearchParams() })).status, 401);
  });
  console.log("All live e2e checks passed. Test users:", users.join(", "));
} finally {
  await browser.close();
}
