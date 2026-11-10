export type KnowledgeChunk = { id: string; file: string; heading: string; content: string };
export type KnowledgeMatch = Pick<KnowledgeChunk, "file" | "heading" | "content"> & { similarity: number };
export type RetrievalTrace = {
  toolCallIndex: number;
  query: string;
  chunks: Pick<KnowledgeMatch, "file" | "heading" | "similarity">[];
};

// Размерность схемы docs/001_create_knowledge_chunks.sql.
export const EMBEDDING_DIMENSIONS = 1536;
