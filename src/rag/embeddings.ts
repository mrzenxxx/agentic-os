import { z } from "zod";
import { EMBEDDING_DIMENSIONS } from "./types";

const responseSchema = z.object({
  data: z.array(z.object({
    index: z.number().int().nonnegative(),
    embedding: z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS),
  })),
});

/** Одинаковая модель и размерность для ingest и query. Конфиг читается лениво. */
export async function embedTexts(input: string[]): Promise<number[][]> {
  const model = process.env.EMBEDDING_MODEL?.trim();
  const key = process.env.EMBEDDING_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  if (!model) throw new Error("Не задан EMBEDDING_MODEL в .env (см. .env.example)");
  if (!key) throw new Error("Не задан EMBEDDING_API_KEY или OPENROUTER_API_KEY в .env");
  if (!input.length || input.some((text) => !text.trim())) throw new Error("Пустой текст для embeddings");
  const base = process.env.EMBEDDING_BASE_URL?.trim() || process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
  const response = await fetch(`${base.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input, dimensions: EMBEDDING_DIMENSIONS, encoding_format: "float" }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Embeddings API: HTTP ${response.status}; проверь модель, endpoint и ключ`);
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`Embeddings API вернул некорректные векторы: ожидается ${EMBEDDING_DIMENSIONS} чисел`);
  const vectors = new Map(parsed.data.data.map((item) => [item.index, item.embedding]));
  if (vectors.size !== input.length || parsed.data.data.length !== input.length) {
    throw new Error("Embeddings API вернул неверное количество векторов");
  }
  return input.map((_, index) => {
    const vector = vectors.get(index);
    if (!vector || !vector.some((value) => value !== 0)) throw new Error("Embeddings API: пропущенный или нулевой вектор");
    return vector;
  });
}
