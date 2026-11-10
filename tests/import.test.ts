import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTimestamp, parseTradeCsv } from "@/lib/import/csv";
import { reconstruct } from "@/lib/engine/reconstruct";

const csv = readFileSync(path.join(__dirname, "fixtures/zerodha-tradebook.csv"), "utf8");

describe("Zerodha tradebook CSV import", () => {
  const r = parseTradeCsv(csv);
  it("detects the Console tradebook format", () => expect(r.format).toBe("zerodha_tradebook"));
  it("rejects invalid rows with row numbers instead of guessing", () => {
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].row).toBe(8);
    expect(r.errors[0].message).toMatch(/trade_date|quantity/);
  });
  it("drops in-file duplicate trade ids", () => {
    expect(r.duplicatesInFile).toBe(1);
    expect(r.executions).toHaveLength(7);
  });
  it("interprets naive timestamps as IST", () => {
    const e = r.executions.find((x) => x.brokerTradeId === "7001")!;
    expect(e.executedAt).toBe("2026-11-02T04:35:12.000Z");
    expect(e.product).toBe("UNKNOWN");
  });
  it("reconstructs trades, keeps open positions and flags pre-import sells", () => {
    const { closedTrades, openPositions, warnings } = reconstruct(r.executions);
    expect(closedTrades.map((t) => t.tradingsymbol).sort()).toEqual(["NIFTYBEES", "TCS"]);
    expect(closedTrades.find((t) => t.tradingsymbol === "NIFTYBEES")!.grossPnl).toBe(-40);
    const tcs = closedTrades.find((t) => t.tradingsymbol === "TCS")!;
    expect(tcs.costProduct).toBe("delivery");
    expect(tcs.grossPnl).toBeCloseTo(10 * 3550 - (3 * 3500 + 7 * 3501), 2);
    expect(openPositions.map((p) => p.tradingsymbol)).toEqual(["ITC"]);
    expect(warnings.some((w) => w.includes("RELIANCE"))).toBe(true);
  });
  it("is idempotent: importing the same file twice yields identical trades", () => {
    const twice = reconstruct([...r.executions, ...parseTradeCsv(csv).executions]);
    expect(twice.closedTrades).toEqual(reconstruct(r.executions).closedTrades);
  });
});

describe("generic CSV + validation", () => {
  it("parses the generic format with product", () => {
    const g = parseTradeCsv("symbol,side,quantity,price,executed_at,exchange,trade_id,product\nSBIN,BUY,5,800,2026-11-02 09:30,NSE,G1,MIS\nSBIN,SELL,5,805,2026-11-02T10:30:00+05:30,NSE,G2,MIS\n");
    expect(g.format).toBe("generic");
    expect(g.executions[0].product).toBe("MIS");
    expect(g.executions[1].executedAt).toBe("2026-11-02T05:00:00.000Z");
  });
  it("refuses unknown headers", () => {
    const g = parseTradeCsv("a,b,c\n1,2,3\n");
    expect(g.format).toBeNull();
    expect(g.errors[0].message).toMatch(/Unrecognised header/);
  });
  it("rejects invalid timestamps", () => {
    expect(parseTimestamp("2026-02-30T25:00")).toBeNull();
    expect(parseTimestamp("not a date")).toBeNull();
    expect(parseTimestamp("02-11-2026 09:15")).toBe("2026-11-02T03:45:00.000Z");
  });
});
