import "dotenv/config";
import { loadKnowledgeChunks } from "../src/rag/chunks";
import { embedTexts } from "../src/rag/embeddings";
import { knowledgeDatabaseConfig, knowledgeRpc } from "../src/rag/supabase";

try {
  knowledgeDatabaseConfig();
  const chunks = loadKnowledgeChunks();
  const rows: (typeof chunks[number] & { embedding: number[] })[] = [];
  console.log(`Knowledge: ${chunks.length} chunks; embeddings: ${process.env.EMBEDDING_MODEL ?? "не настроена"}`);
  for (let start = 0; start < chunks.length; start += 16) {
    const batch = chunks.slice(start, start + 16);
    const vectors = await embedTexts(batch.map((chunk) => `${chunk.file}\n${chunk.content}`));
    rows.push(...batch.map((chunk, index) => ({ ...chunk, embedding: vectors[index] })));
    console.log(`Embeddings: ${rows.length}/${chunks.length}`);
  }
  // DELETE + INSERT происходят только теперь, в одной транзакции внутри SQL RPC.
  const count = await knowledgeRpc("replace_knowledge_chunks", { chunks: rows });
  if (count !== chunks.length) throw new Error(`Supabase вернул неверное число записей: ${count}`);
  console.log(`Индекс заменён: ${count} chunks. Повторный ingest не создаёт дублей.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Ошибка ingest");
  process.exitCode = 1;
}
