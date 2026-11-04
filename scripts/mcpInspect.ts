import { createHealthMcpServer, readHealthResource } from "../src/mcp/healthMcp";

const args = process.argv.slice(2);
const uri = args[0] === "--read" && args.length === 2 ? args[1] : undefined;
if (args.length && !uri) {
  console.error("Использование: npm run mcp:inspect [-- --read <URI>]");
  process.exit(1);
}

const server = createHealthMcpServer();
try {
  await server.connect();
  if (uri) {
    console.log(`Resource: ${uri}\n`);
    console.log(await readHealthResource(server, uri));
  } else {
    console.log("Tools:");
    for (const tool of await server.listTools()) {
      console.log(`  ${tool.name} ${JSON.stringify(tool.inputSchema)}`);
    }
    console.log("\nResources:");
    for (const resource of (await server.listResources()).resources) {
      console.log(`  ${resource.uri} — ${resource.description}`);
    }
  }
} finally {
  await server.close();
}
