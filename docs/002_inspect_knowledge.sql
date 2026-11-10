-- Необязательная проверка после docs/001_create_knowledge_chunks.sql и npm run ingest.
-- Для исходных пяти файлов ожидается 60 строк: по 12 на файл.
SELECT count(*) AS total_chunks, count(DISTINCT id) AS unique_ids
FROM public.knowledge_chunks;

SELECT file, count(*) AS chunks, min(extensions.vector_dims(embedding)) AS dimensions
FROM public.knowledge_chunks GROUP BY file ORDER BY file;

-- Должно вернуть 0 строк.
SELECT file, heading, count(*) AS duplicates
FROM public.knowledge_chunks GROUP BY file, heading HAVING count(*) > 1;

SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'knowledge_chunks';

-- Оба значения должны быть false: анонимному клиенту не доступны эти RPC.
SELECT has_function_privilege('anon', 'public.match_knowledge_chunks(extensions.vector,integer)', 'EXECUTE') AS anon_can_search,
       has_function_privilege('anon', 'public.replace_knowledge_chunks(jsonb)', 'EXECUTE') AS anon_can_replace;
