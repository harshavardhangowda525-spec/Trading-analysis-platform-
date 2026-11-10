/**
 * ESTIMATED Indian equity transaction charges (Zerodha-style schedule).
 *
 * These are estimates only. Statutory rates change and exact charges depend on
 * exchange, segment and contract-note rounding. Any trade whose costs come from
 * this module is labelled `costStatus: "estimated"`. Verified costs (from contract
 * notes) override these values when available.
 *
 * Brokerage is charged per executed ORDER, so legs are grouped by broker order id.
 */
import type { CostLine, InstrumentCategory, TradeLeg } from "./types";
import { localDate } from "./time";

export const FEE_SCHEDULE_VERSION = "in-equity-2025.1";

export const FEE_SCHEDULE = {
  intraday: {
    brokeragePct: 0.0003, // 0.03%
    brokerageCap: 20, // ₹20 per executed order
    sttSellPct: 0.00025, // 0.025% sell side
    stampBuyPct: 0.00003, // 0.003% buy side
  },
  delivery: {
    brokeragePct: 0,
    brokerageCap: 0,
    sttBothPct: 0.001, // 0.1% buy and sell
    stampBuyPct: 0.00015, // 0.015% buy side
    dpPerSellDay: 13.5, // per scrip per sell day, before GST
  },
  etfSttSellPct: 0.00001, // equity-oriented ETF units: sell side (estimate)
  exchangeTxnPct: { NSE: 0.0000297, BSE: 0.0000375 } as Record<string, number>,
  sebiPct: 0.000001, // ₹10 per crore
  gstPct: 0.18, // on brokerage + exchange txn + SEBI (+ DP)
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function estimateCosts(
  legs: TradeLeg[],
  opts: { exchange: string; costProduct: "intraday" | "delivery"; category: InstrumentCategory }
): CostLine[] {
  const S = FEE_SCHEDULE;
  const txnPct = S.exchangeTxnPct[opts.exchange] ?? S.exchangeTxnPct.NSE;
  let buyValue = 0;
  let sellValue = 0;
  const orderValues = new Map<string, number>();
  const sellDays = new Set<string>();
  legs.forEach((l, i) => {
    const v = l.quantity * l.price;
    if (l.side === "BUY") buyValue += v;
    else {
      sellValue += v;
      sellDays.add(localDate(l.executedAt));
    }
    const key = l.brokerOrderId ?? `fill-${i}`;
    orderValues.set(key, (orderValues.get(key) ?? 0) + v);
  });
  const turnover = buyValue + sellValue;

  let brokerage = 0;
  let stt = 0;
  let stamp = 0;
  let dp = 0;
  if (opts.costProduct === "intraday") {
    for (const v of orderValues.values()) brokerage += Math.min(S.intraday.brokerageCap, v * S.intraday.brokeragePct);
    stt = opts.category === "etf" ? sellValue * S.etfSttSellPct : sellValue * S.intraday.sttSellPct;
    stamp = buyValue * S.intraday.stampBuyPct;
  } else {
    stt = opts.category === "etf" ? sellValue * S.etfSttSellPct : turnover * S.delivery.sttBothPct;
    stamp = buyValue * S.delivery.stampBuyPct;
    dp = sellDays.size * S.delivery.dpPerSellDay;
  }
  const txn = turnover * txnPct;
  const sebi = turnover * S.sebiPct;
  const gst = (brokerage + txn + sebi + dp) * S.gstPct;

  const lines: CostLine[] = [
    { component: "brokerage", amount: r2(brokerage), source: "estimated" },
    { component: "stt", amount: r2(stt), source: "estimated" },
    { component: "exchange_txn", amount: r2(txn), source: "estimated" },
    { component: "sebi", amount: r2(sebi), source: "estimated" },
    { component: "gst", amount: r2(gst), source: "estimated" },
    { component: "stamp_duty", amount: r2(stamp), source: "estimated" },
  ];
  if (dp > 0) lines.push({ component: "dp", amount: r2(dp), source: "estimated" });
  return lines;
}

export const sumCosts = (lines: CostLine[]) => r2(lines.reduce((a, l) => a + l.amount, 0));
