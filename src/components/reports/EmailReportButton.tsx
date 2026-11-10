"use client";
import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export function EmailReportButton({ week }: { week: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | string>("idle");
  const send = async () => {
    setState("sending");
    const res = await fetch(`/api/reports/weekly?week=${week}`, { method: "POST" });
    setState(res.ok ? "sent" : (await res.json().catch(() => ({}))).error ?? "Failed");
  };
  return (
    <div className="flex items-center gap-2">
      <Button onClick={send} disabled={state === "sending"}>
        {state === "sending" ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />} {state === "sent" ? "Sent" : "Email"}
      </Button>
      {!["idle", "sending", "sent"].includes(state) && <span className="max-w-40 text-[11px] text-warn">{state}</span>}
    </div>
  );
}
