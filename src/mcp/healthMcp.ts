import { MCPServerStdio } from "@openai/agents";

export const SAVING_AGENT_NAME = "Health Coach Saver";
export const EXPORT_AGENT_NAME = "Health Coach Exporter";

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
export function createHealthMcpServer(options: ConstructorParameters<typeof MCPServerStdio>[0]): MCPServerStdio {
  return new HealthMcpServer({
    ...options,
    // Фильтр callable: SDK кеширует список отдельно для каждого агента.
    // Saver получает единственный обязательный save. Exporter не может повторить
    // его или дописать дневник: экспорт плана не является записью прошедшего дня.
    toolFilter: async ({ agent }, tool) => agent.name === SAVING_AGENT_NAME
      ? tool.name === "save_health_plan"
      : agent.name === EXPORT_AGENT_NAME
        ? tool.name !== "save_health_plan" && tool.name !== "append_daily_log"
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
