import { Agent } from "@openai/agents";

// Ревью по чек-листу с готовым JSON-ответом проще генерации плана, поэтому
// ревьюер сидит на flash (примерно в 20 раз дешевле pro).
const REVIEWER_MODEL = process.env.OPENROUTER_REVIEWER_MODEL ?? "deepseek/deepseek-v4-flash-0731";

// Промпт приходит параметром (версию выбирает харнесс), схема и разбор ответа
// живут в harness/validateReview.ts. Здесь остаётся только конфигурация агента.
export function createSafetyReviewer(instructions: string): Agent {
  return new Agent({ name: "Safety Reviewer", instructions, model: REVIEWER_MODEL });
}
