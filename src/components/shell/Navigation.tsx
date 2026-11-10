"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { MoreHorizontal, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";
import { Logo } from "./Logo";

function useActive() {
  const path = usePathname();
  return (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
}

function useHref() {
  const sp = useSearchParams();
  const range = sp.get("range");
  return (href: string) => (range ? `${href}?range=${range}` : href);
}

export function Sidebar() {
  const isActive = useActive();
  const withRange = useHref();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-line bg-black/20 px-3 py-5 backdrop-blur-xl lg:flex">
      <Link href="/" className="mb-8 px-2">
        <Logo />
      </Link>
      <nav className="flex flex-1 flex-col gap-0.5" aria-label="Primary">
        {NAV.map((n) => {
          const active = isActive(n.href);
          return (
            <Link
              key={n.href}
              href={withRange(n.href)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors",
                active ? "text-text" : "text-text-3 hover:bg-white/[0.04] hover:text-text-2"
              )}
            >
              {active && <motion.span layoutId="side-active" className="absolute inset-0 rounded-xl border border-line-2 bg-white/[0.05]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <n.icon className={cn("relative size-[17px]", active && "text-brass")} aria-hidden />
              <span className="relative">{"longLabel" in n ? n.longLabel : n.label}</span>
            </Link>
          );
        })}
      </nav>
      <p className="px-3 text-[10.5px] leading-relaxed text-text-3">
        Analytics only. TRADEOS never places, modifies or cancels orders.
      </p>
    </aside>
  );
}

export function BottomDock() {
  const isActive = useActive();
  const withRange = useHref();
  const [open, setOpen] = useState(false);
  const primary = NAV.filter((n) => "primary" in n && n.primary);
  const secondary = NAV.filter((n) => !("primary" in n && n.primary));
  const secondaryActive = secondary.some((n) => isActive(n.href));
  return (
    <>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),10px)] lg:hidden">
        <div className="glass mx-auto flex max-w-md items-stretch justify-between rounded-[22px] p-1.5">
          {primary.map((n) => {
            const active = isActive(n.href);
            return (
              <Link key={n.href} href={withRange(n.href)} aria-current={active ? "page" : undefined} className="relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[10.5px] font-semibold">
                {active && <motion.span layoutId="dock-active" className="absolute inset-0 rounded-2xl bg-white/[0.07]" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                <n.icon className={cn("relative size-5", active ? "text-brass" : "text-text-3")} aria-hidden />
                <span className={cn("relative", active ? "text-text" : "text-text-3")}>{n.label}</span>
              </Link>
            );
          })}
          <button onClick={() => setOpen(true)} className="relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[10.5px] font-semibold" aria-haspopup="dialog" aria-expanded={open}>
            {secondaryActive && <span className="absolute inset-0 rounded-2xl bg-white/[0.07]" />}
            <MoreHorizontal className={cn("relative size-5", secondaryActive ? "text-brass" : "text-text-3")} aria-hidden />
            <span className={cn("relative", secondaryActive ? "text-text" : "text-text-3")}>More</span>
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.div
              role="dialog"
              aria-label="More sections"
              className="glass fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] px-4 pb-[max(env(safe-area-inset-bottom),20px)] pt-3 lg:hidden"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_, i) => i.offset.y > 80 && setOpen(false)}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">More</p>
                <button onClick={() => setOpen(false)} className="grid size-9 place-items-center rounded-full bg-white/5" aria-label="Close">
                  <X className="size-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {secondary.map((n) => (
                  <Link key={n.href} href={withRange(n.href)} onClick={() => setOpen(false)} className={cn("flex min-h-[78px] flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-white/[0.03] text-xs font-semibold", isActive(n.href) && "border-brass/40 text-brass")}>
                    <n.icon className="size-5" aria-hidden />
                    {n.label}
                  </Link>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
