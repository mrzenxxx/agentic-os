import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  appendDailyLog,
  listRecipes,
  readLatestPlan,
  readProfile,
  readRecentLogs,
  saveHealthPlan,
} from "./markdownStore";

const server = new McpServer({ name: "markdown-health", version: "1.0.0" });
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const readOnly = { readOnlyHint: true, openWorldHint: false };

server.registerTool("read_profile", {
  description:
    "Читает профиль: цели, ограничения по еде и нагрузке, предпочтения и режим дня. " +
    "Вызывай перед любым планом. Записей последних дней здесь нет — для них read_recent_logs.",
  inputSchema: z.strictObject({}),
  annotations: readOnly,
}, async () => text(readProfile()));

server.registerTool("read_recent_logs", {
  description:
    "Читает N последних записей дневника: сон, еда, нагрузки, самочувствие, вес. " +
    "Это записи, а не календарные дни: дневник ведётся с пропусками. " +
    "Вызывай для плана с учётом последних дней: обычно 3–7 записей, 14 для тренда.",
  inputSchema: z.strictObject({
    days: z.number().int().min(1).max(30).describe("Число последних записей, от 1 до 30."),
  }),
  annotations: readOnly,
}, async ({ days }) => text(readRecentLogs(days)));

server.registerTool("append_daily_log", {
  description:
    "Добавляет запись в дневник, сохраняя предыдущие. Вызывай только когда пользователь " +
    "явно просит записать факты о прошедшем дне. Не записывай предложенный план как " +
    "свершившийся факт и не выдумывай еду, сон или тренировки. Заголовок с датой UTC добавит сервер.",
  inputSchema: z.strictObject({
    entry: z.string().trim().min(1).describe("Текст записи в markdown без заголовка даты."),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ entry }) => text(JSON.stringify(appendDailyLog(entry))));

server.registerTool("save_health_plan", {
  description:
    "Сохраняет одобренный план в data/output.md поверх предыдущего. Передай весь markdown " +
    "дословно, без сокращений. Harness открывает этот инструмент только после approve ревьюера.",
  inputSchema: z.strictObject({
    markdown: z.string().trim().min(1).describe("Полный markdown одобренного плана."),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
}, async ({ markdown }) => text(JSON.stringify(saveHealthPlan(markdown))));

server.registerTool("list_recipes", {
  description:
    "Читает любимые рецепты: продукты с граммовками, калории, белок и приготовление. " +
    "Вызывай при составлении плана питания, чтобы опираться на знакомые блюда. " +
    "Это небольшой фиксированный список, а не полный справочник питания.",
  inputSchema: z.strictObject({}),
  annotations: readOnly,
}, async () => text(listRecipes()));

const resources = [
  { name: "profile", uri: "profile://me", description: "Профиль пользователя", read: readProfile },
  { name: "recent-logs", uri: "logs://recent", description: "Последние 7 записей дневника", read: () => readRecentLogs(7) },
  { name: "recipes", uri: "recipes://all", description: "Любимые рецепты", read: listRecipes },
  { name: "latest-plan", uri: "plans://latest", description: "Последний одобренный план", read: readLatestPlan },
];

for (const resource of resources) {
  server.registerResource(resource.name, resource.uri, {
    description: resource.description,
    mimeType: "text/markdown",
  }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: resource.read() }],
  }));
}

// stdout занят JSON-RPC. Диагностика — только stderr. Закрытие stdin родителем
// завершает процесс; при штатном close() клиента транспорт закрывается SDK.
process.stdin.on("end", () => { void server.close(); });
server.connect(new StdioServerTransport()).catch((error: unknown) => {
  console.error("MCP-сервер не запущен:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
