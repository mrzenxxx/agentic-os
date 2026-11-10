import { generateShoppingListTool } from "./shopping";
import { suggestWorkoutTemplateTool } from "./workouts";
import { searchKnowledgeTool } from "../rag/tool";

/**
 * Локальные инструменты коуча. Доступ к markdown-данным теперь предоставляет
 * MCP-сервер через agent.mcpServers; здесь только операции подготовки плана.
 */

/**
 * generateShoppingList пишет побочный список покупок, как и до MCP.
 * Сохранение самого плана гейтится MCP-фильтром в src/mcp/healthMcp.ts.
 */
export const PLANNING_TOOLS = [
  searchKnowledgeTool,
  suggestWorkoutTemplateTool,
  generateShoppingListTool,
];
