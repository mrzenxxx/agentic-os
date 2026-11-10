-- V7. Выполнить целиком в SQL Editor выбранного Supabase-проекта.
-- Каноническая миграция и документация всей RAG-схемы; личная память сюда не входит.
BEGIN;

-- Не перемещаем существующее расширение и зависимости других приложений.
DO $$
DECLARE vector_schema text;
BEGIN
  SELECT n.nspname INTO vector_schema FROM pg_extension AS e
  JOIN pg_namespace AS n ON n.oid = e.extnamespace WHERE e.extname = 'vector';
  IF vector_schema IS NOT NULL AND vector_schema <> 'extensions' THEN
    RAISE EXCEPTION 'pgvector is already installed in schema %. This migration requires extensions; use a dedicated project or an administrator-reviewed migration.', vector_schema;
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE public.knowledge_chunks (
  id text PRIMARY KEY, -- стабильный SHA-256 от file + heading, создаётся ingest
  file text NOT NULL CHECK (length(file) > 0), -- имя markdown-файла в knowledge/
  heading text NOT NULL CHECK (length(heading) > 0), -- текст ## заголовка
  content text NOT NULL CHECK (length(content) > 0), -- целая секция с заголовком
  embedding extensions.vector(1536) NOT NULL, -- EMBEDDING_MODEL, 1536 float значений
  UNIQUE (file, heading)
);
COMMENT ON TABLE public.knowledge_chunks IS 'Учебная knowledge-база; profile/log остаются в markdown/MCP';
COMMENT ON COLUMN public.knowledge_chunks.embedding IS '1536 измерений; ingest и поиск должны использовать одну EMBEDDING_MODEL';

CREATE INDEX knowledge_chunks_embedding_cosine_idx
  ON public.knowledge_chunks USING hnsw (embedding extensions.vector_cosine_ops);

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.knowledge_chunks FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public, extensions TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.knowledge_chunks TO service_role;

CREATE FUNCTION public.match_knowledge_chunks(
  query_embedding extensions.vector(1536), match_count integer DEFAULT 5
)
RETURNS TABLE (file text, heading text, content text, similarity double precision)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, extensions
AS $$
BEGIN
  IF match_count IS NULL OR match_count < 1 OR match_count > 20
     OR query_embedding IS NULL OR extensions.vector_dims(query_embedding) <> 1536 THEN
    RAISE EXCEPTION 'Expected a 1536-dimensional embedding and match_count 1..20';
  END IF;
  RETURN QUERY
    SELECT k.file, k.heading, k.content,
      greatest(-1.0, least(1.0, 1 - (k.embedding OPERATOR(extensions.<=>) query_embedding)))
    FROM public.knowledge_chunks AS k
    ORDER BY k.embedding OPERATOR(extensions.<=>) query_embedding
    LIMIT match_count;
END;
$$;

CREATE FUNCTION public.replace_knowledge_chunks(chunks jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, extensions
AS $$
DECLARE inserted integer;
BEGIN
  IF chunks IS NULL OR jsonb_typeof(chunks) <> 'array' OR jsonb_array_length(chunks) = 0 THEN
    RAISE EXCEPTION 'Refusing to replace knowledge with an empty or invalid batch';
  END IF;
  -- Сериализуем concurrent ingest; читатели видят старый набор до COMMIT.
  LOCK TABLE public.knowledge_chunks IN SHARE ROW EXCLUSIVE MODE;
  -- Явное условие совместимо с включённым в Supabase safeupdate.
  DELETE FROM public.knowledge_chunks WHERE id IS NOT NULL;
  INSERT INTO public.knowledge_chunks (id, file, heading, content, embedding)
    SELECT item->>'id', item->>'file', item->>'heading', item->>'content',
      (item->>'embedding')::extensions.vector(1536)
    FROM jsonb_array_elements(chunks) AS item;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.match_knowledge_chunks(extensions.vector, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_knowledge_chunks(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_knowledge_chunks(jsonb) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
