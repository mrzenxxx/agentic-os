# V7: простой RAG

Цель: учебная knowledge-база отдельно от личной markdown-памяти, прямые fetch
для embeddings и Supabase RPC с явным SQL, без RAG-фреймворков.

- [x] Пять knowledge/*.md, по 12 самостоятельных секций; личных данных в них нет.
- [x] docs/001_create_knowledge_chunks.sql: схема, vector(1536), HNSW cosine,
  функции поиска и атомарной замены набора, доступ только backend service role.
  Последнее указание пользователя размещать весь SQL в docs имеет приоритет
  над первоначальным путём supabase/migrations/001_knowledge.sql.
- [x] scripts/ingest.ts: chunking по ##, стабильные id, пакетные embeddings,
  замена только после успешного получения всех векторов; повтор без дублей.
- [x] src/rag: embeddings, Supabase RPC, retriever, обычный searchKnowledge tool.
  Один embed запроса и один cosine search, без переписывания и reranking.
- [x] Трейсы: фактический запрос + найденные file/heading/similarity, связь с
  индексом вызова; UI показывает knowledge: query → N chunks и заголовки.
- [x] healthCoach.v5: использовать найденные источники, рецепты не выдумывать;
  профиль выше учебных предпочтений. Memory остаётся в markdown/MCP.
- [x] Шестой eval knowledge-based-recipe проверяет вызов retrieval и recipes.md;
  существующие проверки вердикта/оценки остаются, новые тесты/TDD не пишутся.
- [x] README: настройка, порядок SQL/ingest, 5–6 предложений Memory vs RAG.
- [x] Проверить build, секции, ingest дважды, retrieval и UI/trace.
- [x] Итоговый полный eval: шесть исходных условий на актуальном коде, 6/6 PASS.
- [x] Подключить Supabase пользователя после настройки выбранного проекта.

Ветка v7. 2026-11-10 пользователь запросил слияние v7 в main.

Проверка реализации:
- Настоящие embeddings OpenRouter: openai/text-embedding-3-small, 1536 измерений.
- Изолированный Docker pgvector/PostgREST: миграция применена; ingest дважды →
  60 строк / 60 уникальных id, по 12 на файл, дублей нет. Индекс HNSW есть.
- Невалидная замена откатывается: прежние 60 строк сохранены; anon RPC → 401.
- Реальный UI-запрос ужина: approve 9/10, retrieval6 chunks, источники recipes.md
  использованы в плане; query/heading в UI и JSON trace совпадают.
- UI 375/768/1024/1440, длинный query и 0 chunks: без overflow и ошибок JS.
- Build проходит. Schema preflight
  pgvector выдаёт понятную ошибку до DDL, если расширение уже в другой схеме.
- Добавлен reviewer.v3 с явной wellness/clinical границей и обязательной врачебной
  оговоркой при сохраняющемся ухудшении; клинические запросы и опасные симптомы
  не допускаются. Старый v2 и исходные cases не менялись.
- Ручная проверка reviewer.v3: лекарства → needs, опасные симптомы → needs,
  бытовой режим → approve. Повторное статическое safety-ревью без замечаний.
- Найден пробел в учебных знаниях о дорожном питании: добавлены подходящие
  рецепты и правила хранения. После повторного ingest адресный travel-day →
  approve 10/10 с найденными правилами и рецептом, без reranking или переписывания.
- Источники всегда видны в trace/UI; file/heading в самом плане — по явной просьбе.
  Исторические записи не выдаются за актуальные. По замечанию ревью обоим агентам
  передаётся одно фиксированное время начала запуска.
- Итоговый полный npm run eval на coach.v5/reviewer.v3: exit 0, 6/6 PASS.
  bad-medical-request → needs_human_professional (8), chaotic-nutrition → approve (9),
  knowledge-based-recipe → approve (10), low-energy → approve (8),
  no-gym → approve (9), travel-day → approve (9).
  В новом кейсе два реальных retrieval, в источниках recipes.md; индексы
  retrievals согласованы с [local] searchKnowledge в toolCalls.
  Финальный npm run build → exit 0; независимое ревью закрыто без замечаний.

Обновление 2026-11-10:
- Supabase пользователя подключён через локальный .env; ключи остаются вне Git.
- Найдена ошибка облачного ingest: safeupdate отклоняет DELETE без WHERE.
  В docs/001 добавлено WHERE id IS NOT NULL; docs/003_fix_knowledge_safeupdate.sql
  обновляет функцию уже созданной базы, не затрагивая данные и права.
- После применения исправления в Supabase подтверждены 60 записей;
  реальный пользовательский прогон вернул 5, 5 и 8 chunks через Supabase RPC.
- Метка searchKnowledge в UI заменена с [local] на «База знаний»;
  техническое имя в trace сохраняется для совместимости.
- Перед слиянием повторены build и проверка реального поиска в Supabase;
  независимое ревью не обнаружило Critical/Important замечаний.
