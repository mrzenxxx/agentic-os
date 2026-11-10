import { z } from "zod";
import { embedTexts } from "./embeddings";
import { knowledgeDatabaseConfig, knowledgeRpc } from "./supabase";
import type { KnowledgeMatch } from "./types";

const matchesSchema = z.array(z.object({
  file: z.string().min(1), heading: z.string().min(1), content: z.string().min(1),
  similarity: z.number().finite().min(-1).max(1),
}));

/** Один embed исходного запроса → один SQL cosine search; без переписывания. */
export async function searchKnowledge(query: string, topK = 5): Promise<KnowledgeMatch[]> {
  if (!query.trim() || query.length > 2000) throw new Error("Запрос knowledge должен содержать 1–2000 символов");
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) throw new Error("topK должен быть целым числом 1–20");
  knowledgeDatabaseConfig(); // Ошибка конфигурации до платного embed.
  const [embedding] = await embedTexts([query]);
  const matches = matchesSchema.parse(await knowledgeRpc("match_knowledge_chunks", {
    query_embedding: embedding, match_count: topK,
  }));
  return matches;
}
