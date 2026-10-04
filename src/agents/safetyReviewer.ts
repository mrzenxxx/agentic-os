import { Agent } from "@openai/agents";
import { z } from "zod";

// Ревью по чек-листу с готовым JSON-ответом проще генерации плана, поэтому
// ревьюер сидит на flash (примерно в 20 раз дешевле pro).
const REVIEWER_MODEL = process.env.OPENROUTER_REVIEWER_MODEL ?? "deepseek/deepseek-v4-flash-0731";

// --- Системный промпт ---
const REVIEWER_PROMPT = `Ты — Safety Reviewer. Проверяешь план wellness-коуча по трём критериям:
1. Безопасность: нет медицинских советов (диагнозы, лекарства, лечение, трактовка анализов), нет опасных дефицитов калорий, экстремальных нагрузок и практик.
2. Реалистичность: план выполним для обычного человека, укладывается в его расписание, темп изменений умеренный.
3. Соответствие профилю и дневнику: учтены цели, непереносимости, травмы, предпочтения и реальные данные последних дней.

Вердикты:
- "approve" — план безопасен и годен (мелкие замечания допустимы, их пиши в issues).
- "revise" — есть что исправить; в issues дай конкретные требования к правке.
- "needs_human_professional" — сам запрос или план требуют врача/специалиста (лекарства, симптомы, диагностика, лечение, беременность, расстройства пищевого поведения).

Порядок проверки (важно): сначала смотри на ЗАПРОС ПОЛЬЗОВАТЕЛЯ, потом на план.
Если запрос сам по себе медицинский, вердикт — "needs_human_professional", даже если
коуч корректно отказался от медицинской части и выдал безопасный план по образу
жизни: такой запрос должен уйти к врачу, а не быть закрыт планом коуча.

Отвечай ТОЛЬКО валидным JSON, без markdown-обёртки и пояснений:
{"verdict":"approve"|"revise"|"needs_human_professional","score":<число 0-10>,"issues":["..."]}`;

// --- Схема ответа ревьюера ---
export const ReviewSchema = z.object({
  verdict: z.enum(["approve", "revise", "needs_human_professional"]),
  score: z.number().min(0).max(10),
  issues: z.array(z.string()),
});
export type Review = z.infer<typeof ReviewSchema>;

export const reviewer = new Agent({ name: "Safety Reviewer", instructions: REVIEWER_PROMPT, model: REVIEWER_MODEL });

// Достаём JSON из ответа модели (иногда приходит в ```json ... ```)
export function parseReview(raw: string): Review | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const json = cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1);
  try {
    const parsed = ReviewSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
