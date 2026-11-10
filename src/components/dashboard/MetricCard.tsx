import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function MetricCard({ label, value, sub, hint, tone, badge }: { label: string; value: React.ReactNode; sub?: React.ReactNode; hint?: string; tone?: "pos" | "neg"; badge?: React.ReactNode }) {
  return (
    <div className="glass group relative min-w-0 overflow-hidden rounded-2xl p-3.5 sm:p-4">
      <div className={cn("pointer-events-none absolute -right-8 -top-8 size-24 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100", tone === "neg" ? "bg-neg/15" : tone === "pos" ? "bg-pos/15" : "bg-brass/10")} />
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">{label}</p>
        {hint && (
          <span className="group/hint relative" tabIndex={0} aria-label={hint}>
            <Info className="size-3.5 text-text-3" aria-hidden />
            <span role="tooltip" className="pointer-events-none absolute right-0 top-5 z-20 w-56 rounded-xl border border-line-2 bg-[#0e1117] p-2.5 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-text-2 opacity-0 shadow-xl transition-opacity group-hover/hint:opacity-100 group-focus/hint:opacity-100">
              {hint}
            </span>
          </span>
        )}
      </div>
      <div className="mt-2 truncate text-lg font-bold sm:text-xl">{value}</div>
      {(sub || badge) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-3">
          {badge}
          {sub}
        </div>
      )}
    </div>
  );
}
