"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface Result {
  ok: boolean;
  format: string | null;
  rows: number;
  valid: number;
  inserted?: number;
  duplicates?: number;
  closedTrades?: number;
  newTrades?: number;
  errorCount: number;
  errors: { row: number; message: string }[];
  warnings?: string[];
  error?: string;
}

export function CsvImport({ enabled }: { enabled: boolean }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const upload = async (f: File) => {
    setBusy(true);
    setRes(null);
    const fd = new FormData();
    fd.set("file", f);
    const r = await fetch("/api/import/csv", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({ ok: false, error: "Upload failed" }));
    setRes(d);
    setBusy(false);
    router.refresh();
  };

  return (
    <div>
      <button
        type="button"
        disabled={!enabled || busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
        className={cn("flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition-colors disabled:opacity-50", drag ? "border-brass/60 bg-brass/5" : "border-line-2 hover:border-brass/40")}
      >
        {busy ? <Loader2 className="size-6 animate-spin text-brass" /> : <FileUp className="size-6 text-brass" />}
        <span className="text-sm font-semibold">{busy ? "Validating & importing…" : "Drop a tradebook CSV or tap to choose"}</span>
        <span className="text-xs text-text-3">Zerodha Console → Reports → Tradebook (Equity), or TRADEOS generic CSV · max 5 MB</span>
      </button>
      <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
      {!enabled && <p className="mt-2 text-xs text-text-3">Sign in to import your own history (demo data is read-only).</p>}
      {res && (
        <div className={cn("mt-3 rounded-2xl border p-4 text-xs", res.ok ? "border-pos/25 bg-pos/[0.05]" : "border-neg/25 bg-neg/[0.05]")} role="status">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">{res.ok ? <CheckCircle2 className="size-4 text-pos" /> : <XCircle className="size-4 text-neg" />}{res.ok ? "Import complete" : res.error ?? "Import failed"}</p>
          {res.format && <Badge tone="neutral">{res.format === "zerodha_tradebook" ? "Zerodha tradebook" : "Generic CSV"}</Badge>}
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <K k="Rows" v={res.rows} />
            <K k="New fills" v={res.inserted ?? 0} />
            <K k="Duplicates skipped" v={res.duplicates ?? 0} />
            <K k="Rejected rows" v={res.errorCount} />
            {res.closedTrades != null && <K k="Closed trades (total)" v={res.closedTrades} />}
            {res.newTrades != null && <K k="New trades" v={res.newTrades} />}
          </div>
          {res.errors?.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-text-2">Row errors ({res.errorCount})</summary>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">{res.errors.map((e, i) => <li key={i} className="num text-neg">Row {e.row}: {e.message}</li>)}</ul>
            </details>
          )}
          {res.warnings && res.warnings.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-text-2">Reconstruction warnings ({res.warnings.length})</summary>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-warn">{res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function K({ k, v }: { k: string; v: number }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-text-3">{k}</p>
      <p className="num text-sm font-semibold">{v}</p>
    </div>
  );
}
