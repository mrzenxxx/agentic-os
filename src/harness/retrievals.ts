import type { RunItem } from "@openai/agents";
import { z } from "zod";
import type { RetrievalTrace } from "../rag/types";

const resultSchema = z.object({
  query: z.string(),
  chunks: z.array(z.object({ file: z.string(), heading: z.string(), similarity: z.number().finite() })),
});

/** Факты из результатов SDK, не глобальный лог внутри retrieval-tool. */
export function collectRetrievals(items: RunItem[], offset = 0): RetrievalTrace[] {
  const outputs = new Map<string, unknown>();
  for (const item of items) {
    if (item.type === "tool_call_output_item" && item.callId) outputs.set(item.callId, item.output);
  }
  const retrievals: RetrievalTrace[] = [];
  let index = offset;
  for (const item of items) {
    if (item.type !== "tool_call_item" || item.rawItem.type !== "function_call") continue;
    const toolCallIndex = index++;
    if (item.rawItem.name !== "searchKnowledge") continue;
    let output = outputs.get(item.rawItem.callId);
    if (typeof output === "string") {
      try { output = JSON.parse(output); } catch { continue; }
    }
    const parsed = resultSchema.safeParse(output);
    if (parsed.success) retrievals.push({ toolCallIndex, query: parsed.data.query, chunks: parsed.data.chunks });
  }
  return retrievals;
}
