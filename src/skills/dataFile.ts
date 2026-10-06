import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Доступ скиллов к каталогу `data/`. Единственное место, где скиллы знают,
 * где лежат файлы: сами скиллы оперируют именами файлов, а не путями.
 *
 * Путь считаем от корня проекта — и dev-сервер, и production-сборка
 * запускаются оттуда.
 */

export const dataPath = (file: string) => join(process.cwd(), "data", file);

/**
 * Читает файл из `data/`. Отсутствие файла — не падение прогона, а ответ
 * инструмента: модель должна увидеть текстом, что данных нет, и продолжить
 * работу без них. Иначе один незаполненный файл ронял бы весь прогон.
 */
export function readDataFile(file: string, emptyMessage: string): string {
  try {
    const content = readFileSync(dataPath(file), "utf8").trim();
    return content || emptyMessage;
  } catch {
    return emptyMessage;
  }
}

/** Пишет файл в `data/`, возвращает путь для показа пользователю. */
export function writeDataFile(file: string, content: string): string {
  writeFileSync(dataPath(file), content);
  return `data/${file}`;
}
