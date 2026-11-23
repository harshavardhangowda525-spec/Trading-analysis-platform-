import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export interface SetupStep {
  done: boolean;
  title: string;
  body: string;
  href: string;
  cta: string;
  optional?: boolean;
}

export function GettingStarted({ steps }: { steps: SetupStep[] }) {
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  return (
    <Panel className="mb-5 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brass/80">Get ready to trade</p>
          <h2 className="mt-1 text-lg font-bold">Set up TRADEOS ({done}/{required.length})</h2>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5 sm:w-56" aria-label={`${done} of ${required.length} steps done`}>
          <div className="h-full rounded-full bg-gradient-to-r from-[#ecd4a2] to-[#b48f5a]" style={{ width: `${(done / required.length) * 100}%` }} />
        </div>
      </div>
      <ol className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className={cn("flex gap-3 rounded-xl border p-3.5", s.done ? "border-pos/20 bg-pos/[0.04]" : "border-line bg-white/[0.02]")}>
            {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-pos" aria-label="Done" /> : <Circle className="mt-0.5 size-5 shrink-0 text-text-3" aria-label="To do" />}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">
                {i + 1}. {s.title} {s.optional && <span className="font-normal text-text-3">(optional)</span>}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-text-3">{s.body}</p>
              {!s.done && (
                <Link href={s.href} className="mt-2 inline-flex h-8 items-center rounded-lg bg-white/[0.07] px-3 text-xs font-semibold hover:bg-white/[0.12]">
                  {s.cta}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
