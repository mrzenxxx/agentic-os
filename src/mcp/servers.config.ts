import "dotenv/config";
import { join } from "node:path";

export type McpServerConfig = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
};

const root = process.cwd();
const notionToken = process.env.NOTION_TOKEN?.trim();

/** Новая интеграция = новая запись. Секреты в конфиг не записываем. */
export const MCP_SERVERS: McpServerConfig[] = [
  {
    name: "markdown-health",
    command: process.execPath,
    args: ["--import", "tsx", join(root, "src/mcp/markdownHealthServer.ts")],
    enabled: true,
  },
  {
    name: "filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem@2.2.0", "--confine-roots",
      join(root, "data"), join(root, "plans")],
    enabled: true,
  },
  {
    name: "weather",
    command: "npx",
    args: ["-y", "open-meteo-mcp-server@2.5.6"],
    env: { TRANSPORT: "stdio" },
    enabled: true,
  },
  {
    name: "notion",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server@2.6.1", "--transport", "stdio"],
    env: { NOTION_TOKEN: notionToken ?? "" },
    // false без токена; автоматически true с токеном. Для полного отключения — false.
    enabled: Boolean(notionToken),
  },
];
