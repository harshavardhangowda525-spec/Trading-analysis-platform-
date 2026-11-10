import * as React from "react";
import { cn, inr, pct } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

export function Panel({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={cn("glass relative rounded-2xl", className)} {...p}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, subtitle, action, icon }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-text">
          {icon && <span className="text-brass">{icon}</span>}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-text-3">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

type BtnVariant = "primary" | "ghost" | "outline" | "danger" | "subtle";
export const buttonClass = (variant: BtnVariant = "outline", size: "sm" | "md" | "lg" = "md") =>
  cn(
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none",
    size === "sm" && "h-8 px-3 text-xs",
    size === "md" && "h-10 px-4 text-sm",
    size === "lg" && "h-12 px-5 text-sm",
    variant === "primary" && "bg-gradient-to-b from-[#ecd4a2] to-[#b48f5a] text-[#1a1408] shadow-[0_8px_30px_-10px_rgba(214,183,125,0.6)] hover:brightness-110",
    variant === "outline" && "border border-line-2 bg-white/[0.03] text-text hover:bg-white/[0.07]",
    variant === "ghost" && "text-text-2 hover:bg-white/[0.06] hover:text-text",
    variant === "subtle" && "bg-white/[0.06] text-text hover:bg-white/[0.1]",
    variant === "danger" && "border border-neg/30 bg-neg/10 text-neg hover:bg-neg/20"
  );

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg" }>(
  ({ className, variant, size, ...p }, ref) => <button ref={ref} className={cn(buttonClass(variant, size), className)} {...p} />
);
Button.displayName = "Button";

export function Badge({ tone = "neutral", className, children }: { tone?: "neutral" | "pos" | "neg" | "warn" | "brass" | "signal"; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider",
        tone === "neutral" && "border-line-2 bg-white/[0.04] text-text-2",
        tone === "pos" && "border-pos/25 bg-pos/10 text-pos",
        tone === "neg" && "border-neg/25 bg-neg/10 text-neg",
        tone === "warn" && "border-warn/25 bg-warn/10 text-warn",
        tone === "brass" && "border-brass/30 bg-brass/10 text-brass",
        tone === "signal" && "border-signal/25 bg-signal/10 text-signal",
        className
      )}
    >
      {children}
    </span>
  );
}

/** P&L display: color + glyph + sign — never color alone. */
export function Pnl({ value, className, compact, showIcon = true, size = "md" }: { value: number | null | undefined; className?: string; compact?: boolean; showIcon?: boolean; size?: "sm" | "md" | "lg" | "xl" }) {
  if (value == null) return <span className={cn("num text-text-3", className)}>—</span>;
  const tone = value > 0 ? "text-pos" : value < 0 ? "text-neg" : "text-neutral";
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  const label = value > 0 ? "profit" : value < 0 ? "loss" : "flat";
  return (
    <span className={cn("num inline-flex items-center gap-0.5 font-semibold", tone, size === "sm" && "text-xs", size === "md" && "text-sm", size === "lg" && "text-xl", size === "xl" && "text-3xl sm:text-4xl", className)} aria-label={`${label} ${inr(value)}`}>
      {showIcon && <Icon aria-hidden className={cn(size === "xl" ? "size-6" : size === "lg" ? "size-4" : "size-3.5", "shrink-0")} />}
      {inr(value, { sign: true, compact })}
    </span>
  );
}

export function Pct({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span className="num text-text-3">—</span>;
  return <span className={cn("num", value > 0 ? "text-pos" : value < 0 ? "text-neg" : "text-neutral", className)}>{pct(value, 2, true)}</span>;
}

export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn("h-10 w-full rounded-xl border border-line-2 bg-black/30 px-3 text-sm text-text placeholder:text-text-3 focus:border-brass/50 focus:outline-none", p.className)} />;
}
export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cn("min-h-[84px] w-full rounded-xl border border-line-2 bg-black/30 px-3 py-2 text-sm text-text placeholder:text-text-3 focus:border-brass/50 focus:outline-none", p.className)} />;
}
export function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cn("h-10 w-full rounded-xl border border-line-2 bg-[#0d1016] px-3 text-sm text-text focus:border-brass/50 focus:outline-none", p.className)} />;
}
export function Label({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <span className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-text-3">
      {children}
      {hint && <span className="normal-case tracking-normal font-normal">{hint}</span>}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function Empty({ title, body, action, icon }: { title: string; body?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="mb-1 text-text-3">{icon}</div>}
      <p className="text-sm font-semibold text-text">{title}</p>
      {body && <p className="max-w-sm text-xs leading-relaxed text-text-3">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageTitle({ title, kicker, children }: { title: string; kicker?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass/80">{kicker}</p>}
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function Provenance({ kind }: { kind: "auto" | "user" | "ai" | "estimated" | "verified" | "demo" }) {
  const map = {
    auto: { t: "Auto · broker data", tone: "signal" as const },
    user: { t: "You", tone: "brass" as const },
    ai: { t: "AI interpretation", tone: "warn" as const },
    estimated: { t: "Estimated", tone: "warn" as const },
    verified: { t: "Verified", tone: "pos" as const },
    demo: { t: "Synthetic demo", tone: "warn" as const },
  }[kind];
  return <Badge tone={map.tone}>{map.t}</Badge>;
}
