import { AlertTriangle, CheckCircle2, CircleDashed, Clock } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { Badge, PageTitle, Panel, PanelHeader } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Data Quality" };

const STATUS = {
  complete: { label: "Complete", tone: "pos" as const, icon: CheckCircle2, text: "All closed trades have verified charges and no outstanding warnings." },
  partial: { label: "Partial", tone: "warn" as const, icon: AlertTriangle, text: "Some records are incomplete or use estimated charges. Treat net P&L as provisional." },
  awaiting_verification: { label: "Awaiting verification", tone: "warn" as const, icon: Clock, text: "Trades are reconstructed, but all charges are estimated until contract notes are imported." },
  empty: { label: "No data", tone: "neutral" as const, icon: CircleDashed, text: "No executions have been imported yet." },
};

export default async function DataQualityPage() {
  const ws = await getWorkspace();
  const dq = ws.dataQuality;
  const s = STATUS[dq.status];
  return (
    <>
      <PageTitle kicker="Can these numbers be trusted?" title="Data Quality" />
      <Panel className="mb-4 p-5">
        <div className="flex items-start gap-3">
          <s.icon className="mt-0.5 size-6 shrink-0 text-brass" />
          <div>
            <div className="flex items-center gap-2"><p className="text-base font-semibold">Report status</p><Badge tone={s.tone}>{s.label}</Badge></div>
            <p className="mt-1 text-[13px] text-text-2">{s.text}</p>
          </div>
        </div>
      </Panel>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Raw executions", dq.executions],
          ["Closed trades", dq.closedTrades],
          ["Open positions", dq.openPositions],
          ["Estimated charges", dq.estimatedCostTrades],
          ["Verified charges", dq.verifiedCostTrades],
          ["Journal coverage", `${dq.journalCoverage}%`],
        ].map(([k, v]) => (
          <Panel key={k as string} className="p-4">
            <p className="text-[10.5px] uppercase tracking-wider text-text-3">{k}</p>
            <p className="num mt-1 text-xl font-bold">{v}</p>
          </Panel>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Warnings & reconciliation" />
          <ul className="space-y-2 p-5 text-xs">
            {dq.warnings.length === 0 && <li className="text-text-3">No warnings.</li>}
            {dq.warnings.map((w, i) => <li key={i} className="flex gap-2 text-text-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />{w}</li>)}
            {dq.lastSync && <li className="pt-2 text-text-3">Last sync: {fmtDateTime(dq.lastSync.startedAt, ws.tz)} — {dq.lastSync.status}</li>}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="Import batches" subtitle="Each import is recorded; duplicates are skipped by (exchange, trade id)" />
          <div className="scroll-x px-4 pb-4">
            <table className="w-full min-w-[440px] text-xs">
              <thead className="text-left text-[10.5px] uppercase tracking-wider text-text-3"><tr>{["When", "Source", "File", "New", "Dup", "Errors", "Status"].map((h) => <th key={h} className="py-2 pr-3 font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {dq.batches.map((b) => (
                  <tr key={b.id} className="border-t border-line/60">
                    <td className="num py-2 pr-3 text-text-2">{fmtDateTime(b.createdAt, ws.tz)}</td>
                    <td className="pr-3">{b.source}</td>
                    <td className="max-w-32 truncate pr-3 text-text-2">{b.fileName ?? "—"}</td>
                    <td className="num pr-3">{b.inserted}</td>
                    <td className="num pr-3">{b.duplicates}</td>
                    <td className="num pr-3">{b.errors}</td>
                    <td className="pr-3"><Badge tone={b.status === "completed" ? "pos" : b.status === "partial" ? "warn" : "neg"}>{b.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
