import type { RunItem } from "@openai/agents";
import { tracedToolName } from "../mcp/toolIdentity";

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
 * Повторы сохраняются: два обращения к read_recent_logs — это два разных факта.
 */
export function collectToolCalls(items: RunItem[]): string[] {
  const names: string[] = [];

  for (const item of items) {
    // tool_call_item покрывает все виды вызовов; имя есть только у function_call,
    // а ими являются и локальные tools, и MCP tools после конвертации SDK.
    if (item.type !== "tool_call_item") continue;
    if (item.rawItem.type !== "function_call") continue;
    names.push(tracedToolName(item.rawItem.name));
  }

  return names;
}
