import { after } from "next/server";
import { clientIp, fail, json, requireUser } from "@/lib/api";
import { audit, ingestExecutions, rebuildAnalytics } from "@/lib/data/pipeline";
import { parseTradeCsv } from "@/lib/import/csv";
import { sha256Hex } from "@/lib/security/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Mode B — historical statement import (Zerodha Console tradebook or generic CSV). */
export async function POST(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  if (!(file instanceof File)) return fail("Attach a CSV file");
  if (file.size > 5 * 1024 * 1024) return fail("CSV must be 5 MB or smaller");
  if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/.test(file.type)) return fail("Only .csv files are supported");
  const text = await file.text();
  const parsed = parseTradeCsv(text);
  if (!parsed.format) return json({ ok: false, ...summary(parsed) }, 422);

  const ing = await ingestExecutions(a.sb, a.user.id, parsed.executions, {
    source: "csv",
    fileName: file.name.slice(0, 200),
    sha256: sha256Hex(text),
    rowCount: parsed.rowCount,
    errors: parsed.errors,
  });
  const rb = await rebuildAnalytics(a.sb, a.user.id);
  after(() => audit(a.user.id, "import.csv", { file: file.name, rows: parsed.rowCount, inserted: ing.inserted, duplicates: ing.duplicates, errors: parsed.errors.length }, "broker_import_batches", ing.batchId ?? undefined, clientIp(req)));
  return json({
    ok: true,
    ...summary(parsed),
    inserted: ing.inserted,
    duplicates: ing.duplicates + parsed.duplicatesInFile,
    closedTrades: rb.closedTrades,
    newTrades: rb.newTradeKeys.length,
    openPositions: rb.openPositions,
    warnings: rb.warnings.slice(0, 20),
  });
}

function summary(p: ReturnType<typeof parseTradeCsv>) {
  return { format: p.format, rows: p.rowCount, valid: p.executions.length, errors: p.errors.slice(0, 50), errorCount: p.errors.length };
}
