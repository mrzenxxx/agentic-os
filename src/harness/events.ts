import type { Agent } from "@openai/agents";
import { toolIdentity } from "../mcp/toolIdentity";
import type { Review } from "./validateReview";

export type RunStage = "reading_profile" | "searching_knowledge" | "generating_plan" |
  "reviewing_safety" | "revising" | "final_approved_plan";
export type EventStatus = "running" | "completed" | "error";

type EventBase = { id: string; status: EventStatus; round?: number };
export type StageEvent = EventBase & {
  type: "stage";
  stage: RunStage;
  query?: string;
  verdict?: Review["verdict"];
  score?: number;
  chunkCount?: number;
};
export type ToolEvent = EventBase & {
  type: "tool";
  name: string;
  source: "mcp" | "local" | "rag";
  server?: string;
  query?: string;
};
export type RunEvent = StageEvent | ToolEvent;
export type OnRunEvent = (event: RunEvent) => void;

/** Наблюдатель не участвует в решениях harness и не может сорвать прогон. */
export function safeEventEmitter(onEvent?: OnRunEvent): OnRunEvent | undefined {
  if (!onEvent) return undefined;
  return (event) => {
    try { onEvent(event); }
    catch { console.warn("Не удалось передать событие прогона подписчику"); }
  };
}

/** Реальные lifecycle hooks, без обёрток tools и без передачи их содержимого. */
export function observeToolCalls(agent: Agent, emit: OnRunEvent | undefined, round: number): () => void {
  if (!emit) return () => {};
  const pending = new Map<string, ToolEvent>();

  const onStart: Parameters<typeof agent.on<"agent_tool_start">>[1] = (_context, tool, { toolCall }) => {
    if (toolCall.type !== "function_call") return;
    const identity = toolIdentity(tool.name);
    let query: string | undefined;
    if (identity.name === "searchKnowledge") {
      try {
        const args: unknown = JSON.parse(toolCall.arguments);
        if (args && typeof args === "object" && "query" in args && typeof args.query === "string") query = args.query;
      } catch { /* Невалидные аргументы обрабатывает сам tool. */ }
    }
    const event: ToolEvent = {
      type: "tool", id: `tool-${round}-${toolCall.callId}`, status: "running", round,
      name: identity.name, source: identity.name === "searchKnowledge" ? "rag" : identity.source ? "mcp" : "local",
      server: identity.source, query,
    };
    pending.set(toolCall.callId, event);
    if (event.source === "rag") emit({
      type: "stage", id: `search-${round}-${toolCall.callId}`, stage: "searching_knowledge", status: "running", round, query,
    });
    emit(event);
  };

  const onEnd: Parameters<typeof agent.on<"agent_tool_end">>[1] = (_context, _tool, result, { toolCall }) => {
    if (toolCall.type !== "function_call") return;
    const event = pending.get(toolCall.callId);
    if (!event) return;
    pending.delete(toolCall.callId);
    emit({ ...event, status: "completed" });
    if (event.source === "rag") {
      let chunkCount: number | undefined;
      try {
        const output = JSON.parse(result);
        if (Array.isArray(output?.chunks)) chunkCount = output.chunks.length;
      } catch { /* Содержимое tool не попадает в события. */ }
      emit({
        type: "stage", id: `search-${round}-${toolCall.callId}`, stage: "searching_knowledge", status: "completed",
        round, query: event.query, chunkCount,
      });
    }
  };

  agent.on("agent_tool_start", onStart);
  agent.on("agent_tool_end", onEnd);
  return () => {
    agent.off("agent_tool_start", onStart);
    agent.off("agent_tool_end", onEnd);
    for (const [callId, event] of pending) {
      emit({ ...event, status: "error" });
      if (event.source === "rag") emit({
        type: "stage", id: `search-${round}-${callId}`, stage: "searching_knowledge", status: "error", round, query: event.query,
      });
    }
  };
}
