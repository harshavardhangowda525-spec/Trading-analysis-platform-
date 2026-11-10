import type { Execution, Product, Side } from "@/lib/engine/types";
import { zonedToUtc } from "@/lib/engine/time";

let n = 0;
export function ex(
  symbol: string,
  side: Side,
  qty: number,
  price: number,
  istDate: string,
  istTime: string,
  opts: { product?: Product; order?: string; id?: string; exchange?: string } = {}
): Execution {
  n++;
  const id = opts.id ?? `T${n}`;
  return {
    id: `${opts.exchange ?? "NSE"}:${id}`,
    brokerTradeId: id,
    brokerOrderId: opts.order ?? `O${n}`,
    exchange: opts.exchange ?? "NSE",
    tradingsymbol: symbol,
    product: opts.product ?? "MIS",
    side,
    quantity: qty,
    price,
    executedAt: zonedToUtc(istDate, istTime),
    source: "csv",
    isDemo: false,
  };
}
