import "server-only";
import { chat, llmAvailable, type ChatMessage } from "./groq";
import { COACH_SYSTEM_PROMPT, COACH_TOOLS, routeQuestion, runTool, type CoachContext, type ToolResult } from "./coach";
import { allowedNumbers, checkGrounding } from "./grounding";

export interface CoachAnswer {
  answer: string;
  source: "llm" | "deterministic";
  model: string | null;
  tools: { tool: string; period: string }[];
  tradeIds: string[];
  grounding?: { ok: boolean; ungrounded: string[] };
}

function deterministic(results: ToolResult[]): string {
  const why = results.length > 1;
  const text = results.map((r) => r.summary).join(" ");
  return why ? `${text} These are verified figures from your records; the reasons behind individual losses require your journal notes to confirm.` : text;
}

export async function runCoach(ctx: CoachContext, question: string, history: { role: "user" | "assistant"; content: string }[] = []): Promise<CoachAnswer> {
  const q = question.slice(0, 1000);
  if (!llmAvailable()) {
    const results = routeQuestion(q).map((c) => runTool(ctx, c.name, c.args));
    return { answer: deterministic(results), source: "deterministic", model: null, tools: results.map((r) => ({ tool: r.tool, period: r.period })), tradeIds: [...new Set(results.flatMap((r) => r.tradeIds))] };
  }
  const results: ToolResult[] = [];
  const messages: ChatMessage[] = [
    { role: "system", content: `${COACH_SYSTEM_PROMPT}\nToday is ${ctx.now.toISOString().slice(0, 10)} (${ctx.tz}).` },
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content.slice(0, 1500) })),
    { role: "user", content: q },
  ];
  let model: string | null = null;
  try {
    for (let i = 0; i < 4; i++) {
      const { message, model: m } = await chat(messages, { tools: COACH_TOOLS });
      model = m;
      if (message?.tool_calls?.length) {
        messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
        for (const call of message.tool_calls.slice(0, 4)) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            /* ignore malformed args */
          }
          const r = runTool(ctx, call.function.name, args);
          results.push(r);
          messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify({ period: r.period, data: r.data, summary: r.summary }) });
        }
        continue;
      }
      const text = (message?.content ?? "").trim();
      if (!results.length) {
        // model answered without data — force deterministic tools
        const forced = routeQuestion(q).map((c) => runTool(ctx, c.name, c.args));
        return { answer: deterministic(forced), source: "deterministic", model, tools: forced.map((r) => ({ tool: r.tool, period: r.period })), tradeIds: [...new Set(forced.flatMap((r) => r.tradeIds))] };
      }
      const g = checkGrounding(text, allowedNumbers(results.map((r) => ({ d: r.data, s: r.summary, p: r.period }))));
      return {
        answer: g.ok && text ? text : deterministic(results),
        source: g.ok && text ? "llm" : "deterministic",
        model,
        tools: results.map((r) => ({ tool: r.tool, period: r.period })),
        tradeIds: [...new Set(results.flatMap((r) => r.tradeIds))],
        grounding: { ok: g.ok, ungrounded: g.ungrounded },
      };
    }
  } catch {
    /* fall through */
  }
  const fallback = results.length ? results : routeQuestion(q).map((c) => runTool(ctx, c.name, c.args));
  return { answer: deterministic(fallback), source: "deterministic", model, tools: fallback.map((r) => ({ tool: r.tool, period: r.period })), tradeIds: [...new Set(fallback.flatMap((r) => r.tradeIds))] };
}
