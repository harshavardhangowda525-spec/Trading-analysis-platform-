import { Activity, BookOpen, BrainCircuit, FileBarChart, FlaskConical, LayoutDashboard, PlayCircle, PlugZap, Settings, ShieldCheck, Database } from "lucide-react";

export const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard, primary: true },
  { href: "/journal", label: "Journal", icon: BookOpen, primary: true },
  { href: "/analytics", label: "Analytics", icon: FlaskConical, primary: true },
  { href: "/intelligence", label: "AI", longLabel: "AI Intelligence", icon: BrainCircuit, primary: true },
  { href: "/replay", label: "Replay", longLabel: "Trade Replay", icon: PlayCircle },
  { href: "/risk", label: "Risk", longLabel: "Risk Center", icon: ShieldCheck },
  { href: "/reports", label: "Reports", longLabel: "Weekly Reports", icon: FileBarChart },
  { href: "/broker", label: "Broker", longLabel: "Broker Connections", icon: PlugZap },
  { href: "/data-quality", label: "Data quality", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export const STATUS_META: Record<string, { label: string; tone: "pos" | "neg" | "warn" | "neutral" | "signal" }> = {
  connected: { label: "Connected", tone: "pos" },
  updated: { label: "Updated", tone: "pos" },
  synchronizing: { label: "Synchronizing", tone: "signal" },
  reconnect_required: { label: "Reconnection required", tone: "warn" },
  partial: { label: "Partial data", tone: "warn" },
  sync_failed: { label: "Sync failed", tone: "neg" },
  disconnected: { label: "Not connected", tone: "neutral" },
};

export { Activity };
