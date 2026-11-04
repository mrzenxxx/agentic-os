/** Чистый модуль, общий для trace и UI. Не импортирует конфиг или секреты. */
export function toolIdentity(name: string): { source?: string; name: string } {
  const trace = name.match(/^\[([^\]]+)\] (.+)$/);
  if (trace) return { source: trace[1], name: trace[2] };
  // Нативное пространство имён Agents SDK: includeServerInToolNames: true.
  const mcp = name.match(/^mcp_(.+?)__(.+)$/);
  if (mcp) return { source: mcp[1] === "markdown_health" ? "markdown-health" : mcp[1], name: mcp[2] };
  // Старые трейсы до подключения внешних MCP остаются читаемыми.
  return { name };
}

export function tracedToolName(name: string): string {
  const identity = toolIdentity(name);
  return `[${identity.source ?? "local"}] ${identity.name}`;
}
