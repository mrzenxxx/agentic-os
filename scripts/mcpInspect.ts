import { readHealthResource } from "../src/mcp/healthMcp";
import { createMcpServers, connectMcpServers, closeMcpServers } from "../src/mcp/serverRegistry";
import { MCP_SERVERS } from "../src/mcp/servers.config";

const args = process.argv.slice(2);
const uri = args[0] === "--read" && args.length === 2 ? args[1] : undefined;
const name = args[0] === "--server" && args.length === 2 ? args[1] : undefined;
if (args.length && !uri && !name) {
  console.error("Использование: npm run mcp:inspect [-- --read <URI> | --server <имя>]");
  process.exit(1);
}
const config = MCP_SERVERS.filter((entry) => !name || entry.name === name);
if (name && !config.length) throw new Error(`Неизвестный сервер: ${name}`);
const servers = createMcpServers(config);
try {
  await connectMcpServers(servers);
  if (uri) {
    const health = servers.find((server) => server.name === "markdown-health");
    if (!health) throw new Error("markdown-health отключён");
    console.log(`Resource: ${uri}\n${await readHealthResource(health, uri)}`);
  } else {
    for (const server of servers) {
      console.log(`\n[${server.name}] Tools:`);
      for (const tool of await server.listTools()) {
        console.log(`  [${server.name}] ${tool.name} ${JSON.stringify(tool.inputSchema)}`);
      }
      // Внешний сервер может не объявлять capability resources.
      if (server.name === "markdown-health") {
        console.log("Resources:");
        for (const resource of (await server.listResources()).resources) {
          console.log(`  ${resource.uri} — ${resource.description ?? ""}`);
        }
      }
    }
  }
} finally {
  await closeMcpServers(servers);
}
