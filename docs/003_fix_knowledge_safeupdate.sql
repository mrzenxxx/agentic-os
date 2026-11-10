-- Для проектов, где docs/001_create_knowledge_chunks.sql уже выполнен
-- и ingest завершился ошибкой "DELETE requires a WHERE clause".
-- Выполнить целиком в SQL Editor, затем повторить npm run ingest.
-- Обновляет только функцию; существующие данные и права сохраняются.
BEGIN;

CREATE OR REPLACE FUNCTION public.replace_knowledge_chunks(chunks jsonb)
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

COMMIT;
NOTIFY pgrst, 'reload schema';
