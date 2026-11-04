import { join } from "node:path";
import type { MCPServerStdio } from "@openai/agents";
import { readHealthResource } from "./healthMcp";

/** Контекст собирает harness, ревьюер инструментов не получает. */
export async function readReviewerContext(servers: MCPServerStdio[]): Promise<string> {
  const health = servers.find((server) => server.name === "markdown-health");
  const filesystem = servers.find((server) => server.name === "filesystem");
  const readFile = async (file: string, tail?: number): Promise<string> => {
    if (!filesystem) return "Источник данных отключён. Оцени доступные факты, не выдумывай ограничения.";
    const result = await filesystem.callToolResult("read_text_file", {
      path: join(process.cwd(), "data", file), ...(tail ? { tail } : {}),
    });
    if (result.isError) return `Файл ${file} недоступен.`;
    return result.content.flatMap((item) => item.type === "text" ? [item.text] : []).join("\n");
  };
  const profile = health ? await readHealthResource(health, "profile://me") : await readFile("profile.md");
  const logs = health ? await readHealthResource(health, "logs://recent") : await readFile("log.md", 200);
  return `# ПРОФИЛЬ\n${profile}\n\n# ДНЕВНИК\n${logs}`;
}
