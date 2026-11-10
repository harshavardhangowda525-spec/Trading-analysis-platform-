"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Bell, CalendarRange, CircleUserRound, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { RANGES } from "@/lib/data/range";
import { cn, relTime } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";
import { STATUS_META } from "./nav";
import { Logo } from "./Logo";

export interface TopBarProps {
  mode: "demo" | "live";
  email: string | null;
  connection: { status: string; brokerUserId: string | null; lastSyncedAt: string | null };
  notifications: { id: string; title: string; body: string | null; createdAt: string; readAt: string | null; href?: string }[];
}

export function TopBar({ mode, email, connection, notifications }: TopBarProps) {
  const sp = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();
  const range = sp.get("range") ?? "90d";
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const meta = STATUS_META[connection.status] ?? STATUS_META.disconnected;
  const unread = notifications.filter((n) => !n.readAt && !readIds.includes(n.id));

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const setRange = (r: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("range", r);
    start(() => router.push(`${path}?${q.toString()}`, { scroll: false }));
  };

  const markAll = async () => {
    setReadIds(notifications.map((n) => n.id));
    if (mode === "live") await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-[#06070a]/70 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="lg:hidden">
          <Logo compact />
        </Link>
        <Link href="/broker" className="hidden items-center gap-2 rounded-full border border-line px-3 py-1 text-xs sm:flex" title="Broker connection">
          <span className="font-semibold text-text-2">Zerodha</span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="text-text-3">Synced {relTime(connection.lastSyncedAt)}</span>
        </Link>
        <Link href="/broker" className="sm:hidden" aria-label={`Broker: ${meta.label}`}>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </Link>
        {mode === "demo" && <Badge tone="warn" className="hidden md:inline-flex">Demo data</Badge>}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative hidden items-center md:flex">
            <CalendarRange className="pointer-events-none absolute left-2.5 size-3.5 text-text-3" aria-hidden />
            <select aria-label="Date range" value={range} onChange={(e) => setRange(e.target.value)} className="h-9 appearance-none rounded-xl border border-line-2 bg-white/[0.03] pl-8 pr-3 text-xs font-semibold">
              {RANGES.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
          {pending && <Loader2 className="size-4 animate-spin text-text-3" aria-label="Updating" />}
          <div className="relative" ref={ref}>
            <button onClick={() => setOpen((v) => !v)} className="relative grid size-9 place-items-center rounded-xl hover:bg-white/[0.06]" aria-label={`Notifications, ${unread.length} unread`} aria-expanded={open}>
              <Bell className="size-[18px] text-text-2" />
              {unread.length > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-brass px-1 text-[9px] font-bold text-black">{unread.length}</span>}
            </button>
            <AnimatePresence>
              {open && (
                <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} className="glass absolute right-0 mt-2 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-2xl !bg-[#0e1117]/95">
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <p className="text-sm font-semibold">Notifications</p>
                    <button onClick={markAll} className="text-xs text-text-3 hover:text-text">Mark all read</button>
                  </div>
                  <ul className="max-h-[60vh] overflow-y-auto">
                    {notifications.length === 0 && <li className="px-4 py-6 text-center text-xs text-text-3">No notifications yet.</li>}
                    {notifications.map((n) => (
                      <li key={n.id}>
                        <Link href={n.href ?? "#"} onClick={() => setOpen(false)} className="flex gap-3 border-b border-line/60 px-4 py-3 hover:bg-white/[0.03]">
                          <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", !n.readAt && !readIds.includes(n.id) ? "bg-brass" : "bg-transparent")} />
                          <span className="min-w-0">
                            <span className="block text-[13px] font-semibold">{n.title}</span>
                            {n.body && <span className="block text-xs text-text-3">{n.body}</span>}
                            <span className="mt-1 block text-[10.5px] text-text-3">{relTime(n.createdAt)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <Link href="/settings" className="grid size-9 place-items-center rounded-xl hover:bg-white/[0.06]" aria-label={email ? `Settings for ${email}` : "Settings"}>
            <CircleUserRound className="size-[18px] text-text-2" />
          </Link>
        </div>
      </div>
      {/* mobile range chips */}
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-2.5 md:hidden">
        {RANGES.map((r) => (
          <button key={r.id} onClick={() => setRange(r.id)} className={cn("h-8 shrink-0 rounded-full border px-3 text-xs font-semibold", range === r.id ? "border-brass/40 bg-brass/10 text-brass" : "border-line text-text-3")} aria-pressed={range === r.id}>
            {r.label}
          </button>
        ))}
      </div>
    </header>
  );
}
