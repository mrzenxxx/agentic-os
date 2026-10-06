import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Загрузка версионированных промптов из `prompts/<name>.<version>.md`.
 * Модуль знает только про файлы: ни агентов, ни цикла он не видит.
 */

export type PromptName = "healthCoach" | "safetyReviewer";

/** Какие версии промптов идут в прогон. Новая версия включается правкой этой константы. */
export const ACTIVE_PROMPTS = { coach: "v2", reviewer: "v2" };

/** Версии, которыми фактически отработал прогон: уходят в результат как часть трейса. */
export type PromptVersions = { coach: string; reviewer: string };

// Промпты лежат в prompts/ в корне проекта; и dev-сервер, и production-сборка
// запускаются оттуда же, что и data/.
const promptPath = (name: PromptName, version: string) =>
  join(process.cwd(), "prompts", `${name}.${version}.md`);

/**
 * Читает файл промпта целиком — его содержимое и есть системная инструкция агента.
 * `trim()` снимает завершающий перевод строки, который добавляет редактор:
 * так инструкция совпадает с тем, что раньше лежало в строковом литерале.
 */
export function loadPrompt(name: PromptName, version: string): string {
  const path = promptPath(name, version);
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    throw new Error(`Не найден файл промпта: prompts/${name}.${version}.md`);
  }
}
