import { tool } from "@openai/agents";
import { z } from "zod";

import { readDataFile } from "./dataFile";

/**
 * Скилл «дневник»: сон, еда, тренировки и самочувствие по дням.
 *
 * Дневник растёт бесконечно, поэтому отдавать его целиком нельзя — это ровно та
 * проблема, ради которой контекст и переехал в инструменты. Нарезку делает
 * скилл, а не модель: сколько дней нужно, решает запрос, а не размер файла.
 */

const EMPTY = "Дневник пуст: data/log.md не заполнен.";

/** Заголовок дня в дневнике: `## 2026-08-21 (чт)`. */
const DAY_HEADING = /^## .+$/gm;

/**
 * Последние `days` записанных дней, свежие записи — в конце.
 *
 * Считаем именно записи, а не календарное окно: дневник ведётся с пропусками,
 * и «последние 7 дней по датам» на реальном файле регулярно давали бы пустоту.
 */
export function getRecentLog(days: number): string {
  const diary = readDataFile("log.md", EMPTY);
  if (diary === EMPTY) return EMPTY;

  // Границы дней — позиции заголовков `## ...`; всё до первого заголовка
  // (титул файла) в записи не входит.
  const starts = [...diary.matchAll(DAY_HEADING)].map((match) => match.index);
  if (starts.length === 0) return diary;

  const taken = starts.slice(-days);
  const entries = taken.map((start, index) => {
    const end = index + 1 < taken.length ? taken[index + 1] : diary.length;
    return diary.slice(start, end).trim();
  });

  const header = `Последние записи дневника: ${entries.length} из ${starts.length}.`;
  return `${header}\n\n${entries.join("\n\n")}`;
}

export const getRecentLogTool = tool({
  name: "getRecentLog",
  description:
    "Возвращает последние записи дневника пользователя: сон, приёмы пищи с граммовками, " +
    "тренировки, самочувствие, вода, иногда вес. Вызывай, когда план должен опираться на " +
    "то, что реально происходило: усталость, пропуски еды, нагрузка последних дней, " +
    "динамика веса. Отдаёт N последних ЗАПИСЕЙ, а не календарных дней — дневник ведётся " +
    "с пропусками. Разумный запрос: 3–7 записей для плана на день, 14 — чтобы увидеть тренд.",
  parameters: z.object({
    days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .describe("Сколько последних записей дневника вернуть, от 1 до 30. Обычно 3–7."),
  }),
  execute: async ({ days }) => getRecentLog(days),
});
