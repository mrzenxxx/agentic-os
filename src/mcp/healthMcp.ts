import { join } from "node:path";
import { MCPServerStdio } from "@openai/agents";

export const SAVING_AGENT_NAME = "Health Coach Saver";

class HealthMcpServer extends MCPServerStdio {
  override async callToolResult(...args: Parameters<MCPServerStdio["callToolResult"]>) {
    const result = await super.callToolResult(...args);
    // MCP errors — успешный JSON-RPC ответ с isError:true, а не исключение.
    // Agents SDK сам этот флаг в throw не превращает. Поднимаем ошибку здесь,
    // чтобы stop_on_first_tool не объявил неудачную запись сохранённым планом.
    if (result.isError) {
      const message = result.content.flatMap((content) =>
        content.type === "text" ? [content.text] : [],
      ).join("\n");
      throw new Error(`MCP tool ${args[0]}: ${message || "операция не выполнена"}`);
    }
    return result;
  }
}

/** Один экземпляр = один дочерний процесс на прогон. Lifecycle — в harness. */
export function createHealthMcpServer(): MCPServerStdio {
  const root = process.cwd();
  return new HealthMcpServer({
    name: "markdown-health",
    command: process.execPath,
    args: ["--import", "tsx", join(root, "src/mcp/markdownHealthServer.ts")],
    cwd: root,
    cacheToolsList: true,
    clientSessionTimeoutSeconds: 15,
    // Фильтр callable: SDK кеширует список отдельно для каждого агента.
    // Модель генерации физически не видит сохранение, saver видит только его.
    toolFilter: async ({ agent }, tool) => agent.name === SAVING_AGENT_NAME
      ? tool.name === "save_health_plan"
      : tool.name !== "save_health_plan",
    // Не превращать исключения клиента в обычный model-visible output.
    errorFunction: null,
  });
}

/** Ревьюер не получает tools: harness собирает его текстовый вход из resources. */
export async function readHealthResource(server: MCPServerStdio, uri: string): Promise<string> {
  const result = await server.readResource(uri);
  const texts = result.contents.flatMap((content) =>
    typeof content.text === "string" ? [content.text] : [],
  );
  if (!texts.length) throw new Error(`MCP resource ${uri} не содержит текста`);
  return texts.join("\n\n");
}
