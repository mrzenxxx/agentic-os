export type ChatIconName = "coach" | "mcp" | "local" | "rag" | "send" | "check" | "warning" | "arrow";

const paths: Record<ChatIconName, string> = {
  coach: "M4 13c0-7 7-9 16-9 0 9-2 16-9 16-4 0-7-3-7-7Zm1 6L15 9",
  mcp: "M8 8 4 12l4 4m8-8 4 4-4 4M10 19l4-14",
  local: "M5 5h14v11H5zM3 20h18M9 9l3 2-3 2m5 0h2",
  rag: "m16 16 5 5M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z",
  send: "M12 20V4m-6 6 6-6 6 6",
  check: "m5 12 4 4L19 6",
  warning: "M12 8v5m0 4h.01M3 20h18L12 3 3 20Z",
  arrow: "M12 4v16m-6-6 6 6 6-6",
};

export function ChatIcon({ name }: { name: ChatIconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
