import "server-only";
import { serverEnv } from "@/lib/env";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export const llmAvailable = () => Boolean(serverEnv().groqApiKey);

/** Groq OpenAI-compatible chat completion. The model never computes metrics. */
export async function chat(messages: ChatMessage[], opts: { tools?: ToolDef[]; json?: boolean; maxTokens?: number } = {}) {
  const { groqApiKey, groqModel } = serverEnv();
  if (!groqApiKey) throw new Error("GROQ_API_KEY is not configured");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: groqModel,
      messages,
      temperature: 0.2,
      max_tokens: opts.maxTokens ?? 900,
      ...(opts.tools ? { tools: opts.tools, tool_choice: "auto" } : {}),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`LLM provider error HTTP ${res.status}`);
  const json = await res.json();
  return { message: json.choices?.[0]?.message as ChatMessage, model: groqModel };
}
