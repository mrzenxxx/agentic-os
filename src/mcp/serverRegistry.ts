import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { MCPServerStdio } from "@openai/agents";
import { createHealthMcpServer, EXPORT_AGENT_NAME, SAVING_AGENT_NAME } from "./healthMcp";
import { MCP_SERVERS, type McpServerConfig } from "./servers.config";

/** Ровно один набор процессов на прогон; отключённые записи не создают клиентов. */
export function createMcpServers(config: McpServerConfig[] = MCP_SERVERS): MCPServerStdio[] {
  return config.filter((entry) => entry.enabled).map((entry) => {
    const options = {
      name: entry.name,
      command: entry.command,
      args: entry.args,
      env: entry.env,
      cwd: process.cwd(),
      cacheToolsList: true,
      // Первый npx может скачивать пакет. Не обрываем его пятисекундным default SDK.
      clientSessionTimeoutSeconds: 120,
      toolFilter: async ({ agent }, tool) => {
        // SDK сохраняет MCP annotations в runtime, но его тип фильтра их не описывает.
        const annotated = tool as typeof tool & { annotations?: { readOnlyHint?: boolean } };
        if (agent.name === SAVING_AGENT_NAME) return false;
        return agent.name === EXPORT_AGENT_NAME || annotated.annotations?.readOnlyHint === true;
      },
    } satisfies ConstructorParameters<typeof MCPServerStdio>[0];
    // Специальное правило нашего save_health_plan остаётся у собственного клиента.
    // Внешние tools получают обычный MCPServerStdio, без execute-обёрток.
    return entry.name === "markdown-health"
      ? createHealthMcpServer(options)
      : new MCPServerStdio(options);
  });
}

export async function connectMcpServers(servers: MCPServerStdio[]): Promise<void> {
  // Сервер filesystem требует существующие allowed directories.
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  mkdirSync(join(process.cwd(), "plans"), { recursive: true });
  // Последовательно: ошибка не оставит ещё запускающиеся процессы после cleanup.
  for (const server of servers) await server.connect();
}

export async function closeMcpServers(servers: MCPServerStdio[]): Promise<void> {
  for (const server of [...servers].reverse()) {
    try {
      await server.close();
    } catch (error) {
      console.warn(`Не удалось закрыть MCP [${server.name}]:`, error instanceof Error ? error.message : error);
    }
  }
}
