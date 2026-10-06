import type { RunItem } from "@openai/agents";

/**
 * Трейс вызовов инструментов. Модуль читает элементы прогона Agents SDK и
 * ничего больше: ни файлов, ни агентов, ни состояния.
 *
 * Имена собираются из результата прогона, а не из самих скиллов. Так скиллы
 * остаются чистыми функциями и не знают ни про харнесс, ни про то, что их
 * кто-то считает, а трейс отражает ровно то, что реально вызвала модель.
 */

/**
 * Имена инструментов, вызванных за один прогон, в порядке вызова.
 * Повторы сохраняются: два обращения к getRecentLog — это два разных факта.
 */
export function collectToolCalls(items: RunItem[]): string[] {
  const names: string[] = [];

  for (const item of items) {
    // tool_call_item покрывает все виды вызовов; имя есть только у function_call,
    // а им наши скиллы и являются.
    if (item.type !== "tool_call_item") continue;
    if (item.rawItem.type !== "function_call") continue;
    names.push(item.rawItem.name);
  }

  return names;
}
