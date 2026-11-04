import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { dataPath, readDataFile, writeDataFile } from "../skills/dataFile";

// Хранилище не знает об агентах или MCP. Только сервер вызывает эти функции;
// harness получает данные по протоколу, а не импортирует файловые операции.
export const readProfile = () =>
  readDataFile("profile.md", "Профиль пуст: data/profile.md не заполнен.");

export const listRecipes = () =>
  readDataFile("recipes.md", "Список любимых рецептов пуст: data/recipes.md не заполнен.");

export const readLatestPlan = () =>
  readDataFile("output.md", "Одобренный план пока не сохранён.");

/** N последних записей, а не календарное окно: дневник ведётся с пропусками. */
export function readRecentLogs(days: number): string {
  const empty = "Дневник пуст: data/log.md не заполнен.";
  const diary = readDataFile("log.md", empty);
  if (diary === empty) return empty;

  // В entry разрешён markdown: «## Сон» не является границей нового дня.
  const starts = [...diary.matchAll(/^## \d{4}-\d{2}-\d{2}(?:[ \t].*)?$/gm)]
    .map((match) => match.index);
  if (starts.length === 0) return diary;

  const taken = starts.slice(-days);
  const entries = taken.map((start, index) => {
    const end = index + 1 < taken.length ? taken[index + 1] : diary.length;
    return diary.slice(start, end).trim();
  });
  return `Последние записи дневника: ${entries.length} из ${starts.length}.\n\n${entries.join("\n\n")}`;
}

/** Добавляет отдельную запись с датой UTC, ничего не перезаписывает. */
export function appendDailyLog(entry: string) {
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(dirname(dataPath("log.md")), { recursive: true });
  appendFileSync(dataPath("log.md"), `\n\n## ${date}\n\n${entry.trim()}\n`);
  return { ok: true, path: "data/log.md", date };
}

export function saveHealthPlan(markdown: string) {
  const content = markdown.trim();
  mkdirSync(dirname(dataPath("output.md")), { recursive: true });
  const path = writeDataFile("output.md", `${content}\n`);
  return { ok: true, path, chars: content.length };
}
