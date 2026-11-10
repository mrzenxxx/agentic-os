export function knowledgeDatabaseConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("RAG не настроен: нужны SUPABASE_URL и SUPABASE_SECRET_KEY (или SUPABASE_SERVICE_ROLE_KEY) в .env");
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("SUPABASE_URL должен быть HTTP(S) URL проекта без credentials и query parameters");
  }
  return { url, key };
}

/** Supabase Data API, без клиентского SDK. SQL функций лежит в docs/. */
export async function knowledgeRpc(name: "match_knowledge_chunks" | "replace_knowledge_chunks", args: Record<string, unknown>): Promise<unknown> {
  const { url, key } = knowledgeDatabaseConfig();
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  // Новый sb_secret_* передаётся в apikey; legacy service_role JWT также в Bearer.
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST", headers, body: JSON.stringify(args), signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    // Не печатаем HTTP-заголовки, ключ или целиком payload с embeddings.
    throw new Error(`Supabase ${name}: HTTP ${response.status}. Проверь backend-ключ и выполни docs/001_create_knowledge_chunks.sql`);
  }
  return response.json();
}
