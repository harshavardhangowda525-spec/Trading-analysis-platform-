import { BarChart3, BrainCircuit, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/shell/Logo";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-line p-12 lg:flex">
        <div className="pointer-events-none absolute -left-40 top-1/3 size-[520px] rounded-full bg-brass/10 blur-[120px]" />
        <Logo />
        <div className="relative max-w-md">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brass/80">Trading intelligence</p>
          <h2 className="mt-3 text-4xl font-bold leading-tight tracking-tight">Turn your real trading history into evidence.</h2>
          <ul className="mt-8 space-y-4 text-sm text-text-2">
            <li className="flex gap-3"><BarChart3 className="size-5 shrink-0 text-brass" /> Deterministic P&L, win-rate and drawdown engine — every rupee traceable to a fill.</li>
            <li className="flex gap-3"><BrainCircuit className="size-5 shrink-0 text-brass" /> AI reviews that separate verified facts from hypotheses.</li>
            <li className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-brass" /> Analytics only. No order can ever be placed from TRADEOS.</li>
          </ul>
        </div>
        <p className="text-xs text-text-3">Not investment advice. Educational and journaling use only.</p>
      </div>
      <div className="flex flex-col items-center justify-center gap-8 px-4 py-10">
        <div className="lg:hidden"><Logo /></div>
        <LoginForm supabase={isSupabaseConfigured()} />
      </div>
    </div>
  );
}
