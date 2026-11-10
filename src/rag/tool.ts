import { tool } from "@openai/agents";
import { z } from "zod";
import { searchKnowledge } from "./retriever";

export const searchKnowledgeTool = tool({
  name: "searchKnowledge",
  description: "Ищи в базе знаний рецепты, правила питания, шаблоны тренировок, правила восстановления. " +
    "Вызывай перед составлением wellness-плана. Это учебные знания, а не личный профиль или дневник. " +
    "Возвращает file, heading, content, similarity: используй найденные рецепты и указывай источники; " +
    "ограничения настоящего профиля имеют приоритет над учебными примерами.",
  parameters: z.object({
    query: z.string().trim().min(1).max(2000).describe("Тематический запрос без имени, личной истории и медицинских данных пользователя"),
    topK: z.number().int().min(1).max(20).nullable().describe("Число chunks; null означает 5"),
  }),
  execute: async ({ query, topK }) => ({ query, chunks: await searchKnowledge(query, topK ?? 5) }),
  errorFunction: null,
});
