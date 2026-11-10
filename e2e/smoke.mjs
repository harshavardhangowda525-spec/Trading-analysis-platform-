// End-to-end smoke test of the main demo workflows.
// Usage: npm run dev (or start) in another shell, then:  BASE_URL=http://localhost:3000 npm run e2e
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // npm i -D playwright && npx playwright install chromium
import assert from "node:assert/strict";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const step = async (name, fn) => {
  await fn();
  console.log("✓", name);
};

try {
  await step("login page renders and enters demo", async () => {
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.click("text=Explore the synthetic demo");
    await page.waitForURL(`${base}/`, { waitUntil: "commit", timeout: 60000 });
    await page.waitForSelector("text=Net realized P&L");
    assert.ok(await page.isVisible("text=Demo mode — synthetic data."));
  });
  for (const path of ["/journal", "/analytics", "/analytics?tab=behavior", "/replay", "/intelligence", "/risk", "/reports", "/broker", "/data-quality", "/settings"]) {
    await step(`page ${path} loads`, async () => {
      const r = await page.goto(base + path, { waitUntil: "networkidle", timeout: 90000 });
      assert.equal(r.status(), 200);
    });
  }
  await step("trade detail shows evidence-based review", async () => {
    await page.goto(`${base}/journal`, { waitUntil: "networkidle" });
    await page.goto(base + (await page.locator("table a").first().getAttribute("href")), { waitUntil: "networkidle" });
    await page.waitForSelector("text=Verified facts", { timeout: 30000 });
    await page.waitForSelector("text=Missing information");
  });
  await step("coach answers from records with sources", async () => {
    await page.goto(`${base}/intelligence`, { waitUntil: "networkidle" });
    await page.click("text=What was my win rate last week?");
    await page.waitForSelector("text=get_performance", { timeout: 30000 });
  });
  await step("weekly PDF downloads", async () => {
    const [status, type] = await page.evaluate(async () => {
      const r = await fetch("/api/reports/weekly?week=2026-11-02");
      return [r.status, r.headers.get("content-type")];
    });
    assert.equal(status, 200);
    assert.equal(type, "application/pdf");
  });
  await step("replay never returns future candles", async () => {
    await page.goto(`${base}/replay`, { waitUntil: "networkidle" });
    const key = new URL(page.url()).searchParams.get("trade") ?? (await page.locator("a[href^='/replay?trade=']").first().getAttribute("href")).split("=")[1];
    const d = await page.evaluate(async (k) => (await fetch(`/api/market/candles?trade=${k}&interval=15minute`)).json(), key);
    assert.ok(d.candles.length < d.total, "initial payload must not include the full series");
    assert.ok(d.candles.length <= d.entryIndex + 1);
  });
  await step("cross-origin POST is blocked (CSRF)", async () => {
    const r = await fetch(`${base}/api/coach`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
    assert.equal(r.status, 403);
  });
  await step("order placement endpoints do not exist", async () => {
    const r = await fetch(`${base}/api/orders`, { method: "POST", headers: { Origin: base } });
    assert.equal(r.status, 404);
  });
  assert.deepEqual(errors, [], `page errors: ${errors.join("\n")}`);
  console.log("All e2e checks passed");
} finally {
  await browser.close();
}
