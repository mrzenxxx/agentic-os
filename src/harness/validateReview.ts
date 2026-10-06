import { z } from "zod";

/**
 * Контроль ответа ревьюера: схема, разбор «грязного» JSON и один ретрай.
 * Модуль ничего не знает про агентов — обращение к модели приходит функцией.
 */

export const ReviewSchema = z.object({
  verdict: z.enum(["approve", "revise", "needs_human_professional"]),
  score: z.number().min(0).max(10),
  issues: z.array(z.string()),
});

export type Review = z.infer<typeof ReviewSchema>;

/** Чем догоняем ревьюера, если первый ответ не распарсился. */
const RETRY_HINT = "ПРЕДЫДУЩИЙ ОТВЕТ БЫЛ НЕВАЛИДНЫМ. Верни строго JSON по схеме.";

/** Достаём JSON из ответа модели (иногда приходит в ```json ... ```). */
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

/**
 * Запрашивает ревью и гарантирует, что наружу уйдёт валидная структура.
 * Невалидный JSON — ровно один повтор с подсказкой; второй подряд — ошибка прогона.
 *
 * @param askReviewer обращение к ревьюеру: вход — текст запроса, выход — сырой ответ
 * @param input запрос на ревью, уже собранный оркестратором
 */
export async function requestReview(
  askReviewer: (input: string) => Promise<string>,
  input: string,
): Promise<Review> {
  const first = parseReview(await askReviewer(input));
  if (first) return first;

  console.log("Ревьюер вернул невалидный JSON — повторный запрос");
  const second = parseReview(await askReviewer(`${input}\n\n${RETRY_HINT}`));
  if (second) return second;

  throw new Error("Ревьюер дважды вернул невалидный JSON");
}
