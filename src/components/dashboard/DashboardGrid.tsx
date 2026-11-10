"use client";
import { useEffect, useState } from "react";
import { motion, Reorder, useDragControls } from "motion/react";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, LayoutGrid, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export interface Widget {
  id: string;
  title: string;
  span?: "full" | "half" | "third" | "twoThirds";
  node: React.ReactNode;
}

const KEY = "tradeos.dashboard.layout.v1";
type Layout = { order: string[]; hidden: string[] };

export function DashboardGrid({ widgets, initial, mode }: { widgets: Widget[]; initial: string[]; mode: "demo" | "live" }) {
  const defaults = widgets.map((w) => w.id);
  const [layout, setLayout] = useState<Layout>(() => normalize({ order: initial.filter((x) => !x.startsWith("-")), hidden: initial.filter((x) => x.startsWith("-")).map((x) => x.slice(1)) }, defaults));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw && !initial.length) setLayout(normalize(JSON.parse(raw), defaults));
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (l: Layout) => {
    setLayout(l);
    try {
      localStorage.setItem(KEY, JSON.stringify(l));
    } catch {
      /* ignore */
    }
    if (mode === "live")
      fetch("/api/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dashboard_layout: [...l.order, ...l.hidden.map((h) => `-${h}`)] }) }).catch(() => {});
  };

  const move = (id: string, dir: -1 | 1) => {
    const o = [...layout.order];
    const i = o.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    persist({ ...layout, order: o });
  };
  const toggle = (id: string) => persist({ ...layout, hidden: layout.hidden.includes(id) ? layout.hidden.filter((h) => h !== id) : [...layout.hidden, id] });
  const byId = new Map(widgets.map((w) => [w.id, w]));

  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        {editing && (
          <Button size="sm" variant="ghost" onClick={() => persist({ order: defaults, hidden: [] })}>
            <RotateCcw className="size-3.5" /> Reset
          </Button>
        )}
        <Button size="sm" variant={editing ? "primary" : "outline"} onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
          <LayoutGrid className="size-3.5" /> {editing ? "Done" : "Customize"}
        </Button>
      </div>

      {editing ? (
        <Reorder.Group axis="y" values={layout.order} onReorder={(o) => persist({ ...layout, order: o })} className="space-y-2">
          {layout.order.map((id, i) => (
            <EditRow key={id} id={id} title={byId.get(id)?.title ?? id} hidden={layout.hidden.includes(id)} first={i === 0} last={i === layout.order.length - 1} onMove={move} onToggle={toggle} />
          ))}
        </Reorder.Group>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
          {layout.order
            .filter((id) => !layout.hidden.includes(id) && byId.has(id))
            .map((id, i) => {
              const w = byId.get(id)!;
              return (
                <motion.div
                  key={id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: Math.min(i * 0.04, 0.3) }}
                  className={cn("min-w-0", w.span === "full" && "lg:col-span-6", w.span === "twoThirds" && "lg:col-span-4", w.span === "half" && "lg:col-span-3", (w.span ?? "third") === "third" && "lg:col-span-2")}
                >
                  {w.node}
                </motion.div>
              );
            })}
        </div>
      )}
    </div>
  );
}

function EditRow({ id, title, hidden, first, last, onMove, onToggle }: { id: string; title: string; hidden: boolean; first: boolean; last: boolean; onMove: (id: string, d: -1 | 1) => void; onToggle: (id: string) => void }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={id} dragListener={false} dragControls={controls} className="glass flex items-center gap-2 rounded-xl px-3 py-2.5">
      <button onPointerDown={(e) => controls.start(e)} className="cursor-grab touch-none text-text-3" aria-label={`Drag ${title}`}>
        <GripVertical className="size-4" />
      </button>
      <span className={cn("flex-1 text-sm font-medium", hidden && "text-text-3 line-through")}>{title}</span>
      <button disabled={first} onClick={() => onMove(id, -1)} className="grid size-9 place-items-center rounded-lg hover:bg-white/5 disabled:opacity-30" aria-label={`Move ${title} up`}><ArrowUp className="size-4" /></button>
      <button disabled={last} onClick={() => onMove(id, 1)} className="grid size-9 place-items-center rounded-lg hover:bg-white/5 disabled:opacity-30" aria-label={`Move ${title} down`}><ArrowDown className="size-4" /></button>
      <button onClick={() => onToggle(id)} className="grid size-9 place-items-center rounded-lg hover:bg-white/5" aria-label={hidden ? `Show ${title}` : `Hide ${title}`}>{hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
    </Reorder.Item>
  );
}

function normalize(l: Partial<Layout>, defaults: string[]): Layout {
  const order = (l.order ?? []).filter((x) => defaults.includes(x));
  for (const d of defaults) if (!order.includes(d)) order.push(d);
  return { order, hidden: (l.hidden ?? []).filter((x) => defaults.includes(x)) };
}
