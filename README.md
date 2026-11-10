# Health Coach Agent

Коуч по образу жизни (питание, тренировки, восстановление) с обязательной проверкой
плана вторым агентом. В V8 интерфейс — один чат с потоковой выдачей проверенного
плана и живым таймлайном. Личная память читается через MCP, а учебная база знаний
находится семантическим поиском в Supabase pgvector. Собственный и внешние
MCP-серверы подключаются через один конфиг по stdio; цикл ревью остаётся в harness.

## Запуск

```bash
cp .env.example .env   # вписать OPENROUTER_API_KEY
npm install            # Node.js >= 22
# Перед первым RAG-запуском: настрой Supabase, выполни SQL и npm run ingest (ниже).
npm run dev            # http://localhost:3000
```

Введите задачу в чат и нажмите Enter или кнопку отправки. Shift + Enter добавляет
строку. Этапы и вызовы tools появляются сразу; после approve приходит проверенный
план, внизу — verdict и score. Прогон обычно занимает несколько минут.

История живёт только в состоянии страницы и исчезает после обновления.
Каждый запрос обрабатывает только последнее сообщение; предыдущие реплики не
передаются harness и не добавляются к его JSON-трейсам. Существующий трейс каждого
отдельного запуска и сохранение одобренного плана остаются.

Чат использует Vercel AI SDK 7 (`ai`, `@ai-sdk/react`), нативные HTML-элементы,
CSS module и SVG-иконки. UI-библиотеки в новом чате не используются. Светлая
cyan-green тема использует прежние токены; правила лежат в `CLAUDE.md`.

## Структура

```
app/page.tsx                  useChat, composer, история в памяти, автоскролл
app/layout.tsx                корневой layout: шрифт Inter, globals.css, skip-link
app/globals.css               Tailwind v4 и токены темы
app/api/agent/run/route.ts    POST { task } → { plan, review, rounds }
app/api/chat/route.ts         POST → UIMessage SSE: этапы, tools, одобренный текст, итог
components/chat/*             нативный чат: таймлайн, safety-card, SVG и CSS module
components/ui/*               прежние примитивы shadcn/ui, не используются чатом
components/health/review-widgets.tsx  прежние виджеты ревью
lib/utils.ts                  cn(): clsx + tailwind-merge
prompts/*.v*.md               системные промпты агентов, по файлу на версию
src/agents/healthCoach.ts     фабрика коуча: модель, локальные tools, mcpServers
src/agents/safetyReviewer.ts  фабрика агента-ревьюера: имя и модель, tools нет намеренно
src/mcp/markdownHealthServer.ts  отдельный MCP-процесс: пять tools, четыре resources
src/mcp/markdownStore.ts      операции с markdown: чтение, добавление записи, сохранение
src/mcp/servers.config.ts    декларации всех MCP-серверов и их окружения
src/mcp/serverRegistry.ts    общий lifecycle и фазовый фильтр tools
src/mcp/healthMcp.ts          клиент своего сервера, проверка ошибок, чтение resources
src/mcp/reviewerContext.ts   контекст ревьюера через resources / filesystem fallback
src/mcp/toolIdentity.ts      источник tool для трейса и UI
src/skills/*.ts               локальные shopping/workouts, массив tools + файловый helper
src/rag/*.ts                 chunking, embeddings, Supabase RPC, retriever и локальный tool
knowledge/*.md               учебные знания: 5 файлов по 12 секций
docs/001_create_knowledge_chunks.sql  вся RAG-схема, индекс, RPC и права
docs/002_inspect_knowledge.sql        проверка количества, дублей, размерности и прав
src/harness/runHealthAgent.ts оркестратор: провайдер, цикл коуч ↔ ревьюер, фазы tools
src/harness/events.ts         типы событий, безопасный callback, SDK lifecycle hooks
src/chat/types.ts             типизированные data-event/data-result части чата
src/chat/request.ts           проверка запроса и извлечение последней user-задачи
src/harness/validateReview.ts схема ревью, разбор JSON и один ретрай
src/harness/rounds.ts         RoundState и история раундов
src/harness/score.ts          итоговый score и флаг improved
src/harness/promptVersions.ts загрузка промптов и ACTIVE_PROMPTS
src/harness/toolCalls.ts      имена вызванных tools из результата прогона
src/harness/traceRun.ts       запись трейса прогона в runs/<runId>.json
scripts/replay.ts             повтор задачи из трейса текущим кодом
scripts/eval.ts               прогон кейсов из evals/cases и таблица PASS/FAIL
scripts/mcpInspect.ts         список MCP tools и resources без вызовов модели
scripts/ingest.ts             embeddings knowledge и атомарная замена индекса
evals/cases/*.json            кейсы: { name, task, expect }
runs/*.json                   трейсы прогонов (в .gitignore, кроме run-example.json)
data/profile.md               профиль пользователя (MCP)
data/log.md                   дневник: чтение и добавление записей (MCP)
data/recipes.md               любимые рецепты (MCP)
data/output.md                последний одобренный план (выход)
data/shopping.md              список покупок к плану (выход)
plans/*.md                   дополнительные копии одобренных планов (filesystem MCP)
```

## Флоу

1. `useChat` отправляет последнее user-сообщение в `POST /api/chat`.
   Прежний JSON endpoint `POST /api/agent/run` с `{ task }` остаётся доступен.
2. `runHealthAgent(task)` читает конфиг, запускает enabled MCP-процессы и передаёт коучу задачу.
   Перед wellness-планом коуч вызывает локальный `searchKnowledge`, затем использует
   найденные знания с учётом личного профиля. Запрос и найденные заголовки пишутся в trace.
   Коуч достаёт профиль, дневник и рецепты через MCP tools. Harness читает
   `profile://me` и `logs://recent`, чтобы передать ревьюеру фиксированный контекст.
   При отключённом markdown-health профиль и последние 200 строк дневника читаются
   через готовый filesystem tool (если он включён). Без обоих источников недостающие
   данные нельзя выдумывать. Внешние tools записи скрыты до approve по MCP-аннотации readOnlyHint.
3. До трёх раундов: коуч пишет план → ревьюер возвращает JSON `{ verdict, score, issues }`.
   Невалидный JSON — один ретрай, второй подряд — ошибка.
4. Развилка по вердикту:
   - `approve` — `Health Coach Saver` получает единственный обязательный tool
     `save_health_plan` и сохраняет план в `data/output.md` (если сервер включён).
     Затем `Health Coach Exporter` выполняет явно запрошенные дополнительные
     записи через filesystem или Notion. План уходит в UI;
   - `needs_human_professional` — план не сохраняется и **не отдаётся** (`plan: null`),
     чат показывает карточку «Требуется специалист» с issues;
   - `revise` — замечания уходят коучу на следующий раунд; если три раунда прошли
     без одобрения, чат показывает issues с вердиктом `revise` без текста плана.
     Прежний JSON API по-прежнему возвращает последний план и rounds.
5. В `finally` harness закрывает все MCP-соединения и дочерние процессы, в том числе
   при ошибке. Ошибка сохранения плана, как и раньше, не отменяет готовый ответ;
   отчёт о сохранении/ошибке показывается в UI отдельно от проверенного плана.

Ответ прежнего JSON API `/api/agent/run`:

```ts
{
  plan: string | null,
  review: { verdict, score, issues },   // ревью последнего раунда
  rounds: { round, plan, review }[],    // трейс всех раундов
  toolCalls: string[],                  // "[источник] tool", по порядку
  retrievals: { toolCallIndex: number, query: string,
    chunks: { file: string, heading: string, similarity: number }[] }[],
  saveSummary: string | null,           // отчёт о записи, включая ошибки/URL Notion
  finalScore: number | null,            // score последнего approve
  improved: boolean,                    // вырос ли score на последней ревизии
  promptVersions: { coach: string, reviewer: string },
  durationMs: number
}
```

`maxRounds` — второй параметр `runHealthAgent(task, maxRounds = 3, onEvent?)`.

### Поток чата

Третий аргумент — опциональный синхронный callback `(event: RunEvent) => void`.
Без него API, CLI и evals работают как прежде. Ошибка подписчика не меняет исход
прогона. События tools приходят через Agent hooks, listeners снимаются в finally.
Они содержат имя, источник и статус, но не профиль, аргументы записи или tool outputs.
Для searchKnowledge разрешены query и количество найденных chunks.

`data-event` с постоянным id обновляет шаг running → completed; новый вызов или
раунд получает свой id. UI показывает Reading profile, Generating plan, Searching
knowledge с запросом (если поиск был), Reviewing safety с verdict/score, Revising
(round N) при повторном раунде и Final approved plan. Источники tools обозначены
иконками и `[mcp]`, `[local]`, `[rag]`; RAG подписан «База знаний».

Safety Reviewer проверяет целый план, поэтому модель сначала завершает генерацию
и ревью. Только после approve роут передаёт **уже проверенный текст** небольшими
частями `text-delta`. Это потоковая выдача готового плана, а не live-токены
непроверенного черновика и не повторная генерация моделью. При needs или
исчерпанных revise текстовые части не отправляются. `data-result` содержит итог
проверки и метаданные, без plan и rounds с черновиками.

Автоскролл следует за обновлениями, пока пользователь находится внизу. При чтении
истории он отключается; кнопка «К последнему сообщению» возвращает его. Ввод
заблокирован до конца потока; при ошибке разблокируется. Отключение клиента
останавливает отправку частей; уже начавшийся harness завершает свой обычный
цикл и закрывает MCP в finally. Возобновления потока и персиста чата нет.

## Memory vs RAG

`data/profile.md` и `data/log.md` — личная память: кто пользователь, какие у него
цели, ограничения и что происходило в его жизни.
Она остаётся в markdown и читается через MCP, в Supabase её не переносим.
`knowledge/` — база знаний: какие рецепты, правила питания, тренировок и восстановления
умеет использовать коуч, а не факты о конкретном человеке.
RAG превращает разделы этой базы в embeddings и находит подходящие разделы по смыслу запроса.
Коуч получает найденные тексты с названиями источников и применяет их с учётом личной памяти.
Даже `personal_preferences.md` здесь содержит только вымышленные учебные примеры:
настоящий профиль всегда имеет приоритет.

### Настройка Supabase и embeddings

1. Выбери отдельный Supabase-проект для этой учебной базы. В его SQL Editor один раз
   выполни целиком [`docs/001_create_knowledge_chunks.sql`](docs/001_create_knowledge_chunks.sql).
   В соответствии с договорённостью весь SQL находится в `docs/`, вместо первоначального
   пути `supabase/migrations/001_knowledge.sql`; отдельной расходящейся копии нет.
   Если миграция уже выполнена, но ingest падает с `DELETE requires a WHERE clause`,
   выполни [`docs/003_fix_knowledge_safeupdate.sql`](docs/003_fix_knowledge_safeupdate.sql):
   он обновляет функцию загрузки для совместимости с Supabase safeupdate, сохраняя данные и права.
2. В локальном `.env` задай `SUPABASE_URL` и backend-ключ `SUPABASE_SECRET_KEY`
   (`sb_secret_...`). Legacy `SUPABASE_SERVICE_ROLE_KEY` также поддерживается.
   Не используй publishable/anon-ключ и не добавляй префикс `NEXT_PUBLIC_`.
3. Задай `EMBEDDING_MODEL`, например `openai/text-embedding-3-small`, и
   `EMBEDDING_BASE_URL=https://openrouter.ai/api/v1`. С текущим OpenRouter используется
   `OPENROUTER_API_KEY`; для другого OpenAI-compatible endpoint задай `EMBEDDING_API_KEY`
   и соответствующие base URL и модель. Запрос идёт в `/embeddings`, без SDK-обёртки.
4. Выполни:

```bash
npm run ingest
npm run ingest   # тот же набор: без дублей
```

Размерность схемы — **1536**: модель должна поддерживать этот размер embedding.
Расширение pgvector создаётся в стандартной схеме `extensions`. Если оно уже
установлено в другой схеме, миграция остановится до создания таблицы с явным
сообщением; она не перемещает расширение и зависимости других приложений.
Ingest и поиск используют один код и одну модель из `.env`. После правок файлов
в `knowledge/` тоже выполняй `npm run ingest`, чтобы обновить индекс. При смене модели
нужно выполнить ingest заново; одинаковая размерность разных моделей не делает
их векторы совместимыми. `EMBEDDING_API_KEY`, backend-ключ Supabase и `.env` остаются
на сервере и не передаются в UI или модель коуча.

В базе одна таблица `knowledge_chunks`: `id` (стабильный SHA-256 от file/heading),
`file`, `heading`, `content`, `embedding vector(1536)`, уникальность file/heading.
HNSW-индекс использует `vector_cosine_ops`. SQL RPC `match_knowledge_chunks`
возвращает topK по cosine distance, similarity вычисляется как `1 - distance`.
Таблица закрыта RLS, функции и операции доступны только backend-роли `service_role`.
Тексты SQL-функций и вся схема находятся в миграции, никакой SQL генерации моделью нет.

Ингест читает только обычные `knowledge/*.md`, разделяет по `##` и считает каждую
секцию отдельным chunk с file/heading. Пять файлов содержат по 12 секций — всего 60 chunks.
Сначала получаются все embeddings пакетами по 16, затем `replace_knowledge_chunks`
в одной транзакции удаляет старые строки и вставляет новые. Если embeddings или
INSERT завершились ошибкой, прежний индекс остаётся; параллельные ingest сериализуются.
Проверочные SELECT и проверка прав находятся в [`docs/002_inspect_knowledge.sql`](docs/002_inspect_knowledge.sql).
[`docs/000_local_pgvector_roles.sql`](docs/000_local_pgvector_roles.sql) нужен только
для изолированной проверки на обычном Postgres с pgvector; в Supabase роли уже есть.

### Поиск и демо

`searchKnowledge(query, topK = 5)` — один embedding исходного query и один SQL
similarity search через Supabase Data API (`fetch` → RPC). Нет reranking, hybrid
search, query rewriting, LangChain или LlamaIndex. Это обычный локальный tool,
рядом с shopping/workouts; MCP отвечает за личную память и внешние интеграции.
Без настройки Supabase запрос с RAG завершается понятной ошибкой настройки,
без подмены pgvector-поиска чтением файла или вымышленными результатами.

В UI введи: **«Предложи ужин с высоким белком без молочки»**.
Коуч сначала ищет знания, читает профиль и выбирает найденный рецепт. Источники
показаны в списке действий; по явной просьбе коуч укажет файл и заголовок в плане. В «Что сделал агент» будет значок поиска
и `knowledge: <query> → N chunks` с меткой «База знаний», ниже — названия найденных источников.
В `runs/*.json` поле `retrievals` содержит настоящий query, file/heading/similarity
найденных chunks и индекс соответствующего tool call; целиком тексты chunks в трейс
не копируются. Список `toolCalls` по-прежнему содержит `[local] searchKnowledge`.

Шестой кейс `evals/cases/knowledge-based-recipe.json` проверяет не только approve
и score, но и фактический вызов retrieval с найденным `recipes.md`. Для этого
`expect.retrievalFile` добавлен в существующий eval runner; остальные пять кейсов
сохраняют прежние условия. Для запуска `npm run eval` нужны готовый индекс и ключи.

Справка: [Supabase vector columns](https://supabase.com/docs/guides/ai/vector-columns),
[HNSW](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes),
[ключи Supabase](https://supabase.com/docs/guides/getting-started/api-keys),
[OpenRouter embeddings](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request).

## До MCP / После MCP

| До MCP (V3–V4) | После MCP (V5) |
| --- | --- |
| Каждая интеграция подключалась вручную: импорт функции, Zod-обёртка `tool()`, массив tools агента. | Агент получает `mcpServers: servers`; Agents SDK обнаруживает схемы tools и вызывает их по стандартному протоколу. |
| Профиль, дневник, рецепты и запись плана выполнялись внутри процесса приложения. | Операции с markdown выполняет отдельный процесс `markdownHealthServer.ts`, связь — stdin/stdout JSON-RPC. |
| Контекст ревьюера читался прямыми функциями. | Harness читает MCP resources и передаёт ревьюеру текст; у ревьюера по-прежнему нет tools. |
| Переиспользование интеграции требовало знания модулей этого приложения. | Любой совместимый MCP-клиент может обнаружить tools/resources сервера без импорта кода агента. |

Внутри сервера операции с файлами по-прежнему реализованы явно. MCP стандартизирует
обнаружение и вызов интеграции, а не пишет её за нас. Два локальных tools,
`generateShoppingList` и `suggestWorkoutTemplate`, намеренно оставлены для сравнения.
Все инструменты модели попадают в один `toolCalls`: например,
`[markdown-health] read_profile → [weather] geocoding → [weather] weather_forecast
→ [local] suggestWorkoutTemplate → [markdown-health] save_health_plan`.
Чтение resources самим harness туда не попадает: это не вызов инструмента моделью.
В UI каждый вызов отмечен источником: `[markdown-health]`, `[filesystem]`,
`[weather]`, `[notion]`, `[local]`; точное имя инструмента остаётся рядом.
Незнакомый tool нового сервера тоже получает источник, без изменений UI. Старые прямые profile/logs/plans/recipes tools удалены;
в `src/skills/` используются shopping, workouts, их массив и файловый helper.

### Интерфейс markdown-health

| Tool | Параметры | Действие |
| --- | --- | --- |
| `read_profile` | `{}` | Читает `data/profile.md`. |
| `read_recent_logs` | `{ days: 1..30 }` | Возвращает N последних записей `data/log.md`, как до MCP; это число записей, а не календарное окно. |
| `append_daily_log` | `{ entry: string }` | Добавляет запись в `data/log.md` с заголовком даты UTC. Коуч вызывает только по явной просьбе записать сообщённые факты. |
| `save_health_plan` | `{ markdown: string }` | Перезаписывает `data/output.md` одобренным планом. |
| `list_recipes` | `{}` | Читает `data/recipes.md`. |

| Resource | Содержимое |
| --- | --- |
| `profile://me` | Профиль. |
| `logs://recent` | Последние 7 записей дневника. |
| `recipes://all` | Все любимые рецепты. |
| `plans://latest` | Последний сохранённый план. |

Фильтры `toolFilter` скрывают `save_health_plan` и внешние операции записи от
планировщика. Внешний tool доступен до approve только с `readOnlyHint: true`;
без аннотации он считается потенциально пишущим. Это фазовый контроль harness,
а не защита от произвольного MCP-клиента. `append_daily_log` нашего сервера доступен
планировщику только для явного запроса пользователя о фактах; saver и exporter его не получают.
Основной saver сохраняет прежние `toolChoice: required` и `stop_on_first_tool`.
Exporter получает внешние tools записи, может сделать несколько вызовов и не
получает `save_health_plan`, поэтому не повторяет основную запись. Даже при ошибке
после частичного экспорта уже состоявшиеся вызовы извлекаются из состояния SDK
и остаются в toolCalls.
MCP tools внешних серверов подключаются напрямую средствами Agents SDK, без обёрток
над исполнением или изменения их схем. Собственный клиент по-прежнему проверяет
`isError`, чтобы ошибка основного сохранения не выглядела успешной записью.

## Подключённые серверы V5

Конфиг: [`src/mcp/servers.config.ts`](src/mcp/servers.config.ts).
Новая интеграция — новая запись `{ name, command, args, env?, enabled }`,
**ноль правок harness**. SDK сам обнаруживает tools и исполняет их через MCP.
Локальные shopping/workouts остаются обычными tools.

| Имя | Пакет / запуск | Что даёт | Авторизация |
| --- | --- | --- | --- |
| markdown-health | свой `src/mcp/markdownHealthServer.ts` | Профиль, дневник, рецепты, основной план, resources | Нет |
| filesystem | [`@modelcontextprotocol/server-filesystem@2.2.0`](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) | Чтение/запись только `data/` и `plans/` | Нет, граница — allowed directories |
| weather | [`open-meteo-mcp-server@2.5.6`](https://github.com/cmer81/open-meteo-mcp) | `geocoding`, `weather_forecast` и другие read-only погодные tools Open-Meteo | Без API-ключа; бесплатный API для некоммерческого использования |
| notion | [`@notionhq/notion-mcp-server@2.6.1`](https://github.com/makenotion/notion-mcp-server) | Поиск, создание страниц, чтение/изменение блоков | `NOTION_TOKEN`, internal integration; без OAuth |

Weather проверен как npm CLI: `npx -y open-meteo-mcp-server@2.5.6`, stdio,
геокодинг города и реальный прогноз по возвращённым координатам. Пакет требует
Node.js >= 22. Версии внешних серверов зафиксированы в конфиге. Первый `npx`
скачивает пакеты из npm; соединение допускает до 120 секунд на запрос.
Приложение общается с процессами только через stdio; weather и Notion внутри
обращаются к своим HTTPS API. Сетевые MCP-транспорты не используются.

Notion по умолчанию выключен: `enabled: Boolean(notionToken)` даёт `false`
без токена и автоматически включает сервер с непустым `NOTION_TOKEN` в `.env`.
После изменения `.env` перезапусти Next.js. Чтобы выключить даже с токеном,
поставь в записи `enabled: false`. Любая выключенная запись пропускается молча,
её процесс не запускается, tools не передаются агенту. Отключение собственного
сервера также отключает чтение его resources и основное сохранение, без ошибки;
контекст ревьюера тогда читается через filesystem, если он включён.
Официальный локальный Notion-пакет больше не поддерживается активно — это
указано в его README; здесь он используется по условию задания, без перехода
на предлагаемый Notion OAuth-сервис.

### «Промпт — просьба, конфиг — стена»

- **Filesystem:** сервер запущен с абсолютными путями только `data/` и `plans/`
  и флагом `--confine-roots`. Он отклоняет доступ к `.env`, исходникам, соседним
  каталогам и выход наружу через symlink; клиентские Roots не могут расширить
  разрешённые каталоги. В `healthCoach.v5.md` дополнительно сказано работать
  только внутри этих двух папок. Внутри них сервер имеет чтение и запись:
  это не разграничение прав между отдельными файлами и не OS-песочница процесса.
- **Notion:** создай internal integration с чтением/добавлением/обновлением,
  в её Content access выдай **только одну** родительскую страницу или базу
  **Wellness**, включая нужных потомков. Не выдавай доступ ко всему workspace.
  Токен положи в `NOTION_TOKEN`. Стена здесь — права integration на стороне Notion;
  наличие токена само по себе её не создаёт, код не может сузить уже выданный доступ.
  Промпт просит писать только внутрь однозначно найденной Wellness. При нескольких
  совпадениях или отсутствии доступа агент сообщает об ошибке вместо выбора наугад.
- **Weather:** tools выбранного сервера только читают публичные данные.
  Разрешений на запись и конфиденциальных токенов у него нет, поэтому ограничения
  директорий или страниц ему не нужны. Не все MCP-серверы одинаково опасны.

MCP-аннотации readOnlyHint помогают распределять tools по фазам, но являются
заявлением сервера, а не заменой его реальных ограничений доступа.

### Демо из UI

1. **Погода:** «Спланируй тренировку на завтра с учётом погоды». В `data/profile.md`
   нужно поле `Город: <город>, <страна>`. Агент сам получает
   координаты через `geocoding`, запрашивает прогноз на нужную дату, ссылается на
   Open-Meteo и переносит активность в зал/дом при плохой погоде. Никакого кода
   геокодинга или запроса прогноза в приложении нет: вызовы выполняет готовый сервер.
2. **Файл:** «Составь план на завтра и сохрани его ещё и в отдельный файл
   plans/<дата>.md, где <дата> — дата плана в формате YYYY-MM-DD». После approve
   в трейсе появится `[filesystem] write_file`, в `plans/` — markdown с планом.
3. **Notion (с токеном):** «Составь план и сохрани его страницей в мой Notion,
   внутри Wellness». После approve агент находит Wellness и создаёт дочернюю
   страницу через notion-tools; отчёт в UI содержит URL. Без токена Notion не
   запускается, план продолжает работать, экспорт отмечается как недоступный.

Дополнительно полезны, но **не подключены**: [Google Calendar MCP](https://github.com/nspady/google-calendar-mcp)
(требует OAuth, потому вынесен за скобки), [DBHub](https://github.com/bytebase/dbhub)
(работа с SQL-базами), [Brave Search MCP](https://github.com/brave/brave-search-mcp-server)
(веб-поиск, нужен API-ключ).

### Демо без модели

```bash
npm run mcp:inspect
```

Команда запускает все enabled-серверы, печатает tools с источниками и JSON-схемами
и четыре URI resources собственного сервера, затем закрывает процессы. Ключ OpenRouter не нужен, содержимое личных файлов не выводится.
Один сервер: `npm run mcp:inspect -- --server weather` (или `filesystem`, `notion`,
`markdown-health`). Выключенный сервер не запускается и ничего не печатает.
Для проверки содержимого resources вызови чтение по URI:

```bash
npm run mcp:inspect -- --read profile://me
npm run mcp:inspect -- --read logs://recent
npm run mcp:inspect -- --read recipes://all
npm run mcp:inspect -- --read plans://latest
```

С `--read` команда выводит markdown из resource, включая личные данные, и закрывает
MCP-процесс. Запись файлов и вызовы модели для этой проверки не нужны.

Сервер также можно запустить напрямую: `node --import tsx src/mcp/markdownHealthServer.ts`.
Его stdout занят протоколом; диагностику писать только в stderr.

Next.js запускается из корня проекта: там должны оставаться `src/mcp/`, `data/`,
`prompts/` и `node_modules/`. `tsx` — runtime-зависимость, поскольку MCP-сервер
выполняется отдельным Node-процессом и после `npm run build` / `npm run start`.
Все процессы принадлежат одному прогону; отдельного постоянно работающего демона нет.

Справка: [MCP в OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents/integrations-observability),
[stdio в MCP SDK v1](https://ts.sdk.modelcontextprotocol.io/server#stdio).

## Как дебажить агента

Три шага, от «что вообще произошло» к «стало ли лучше»: **trace → replay → eval**.

### 1. Trace — что произошло в конкретном прогоне

Каждый прогон, откуда бы он ни был запущен, пишет `runs/run-<timestamp>.json`:
задача, версии промптов, модели, раунды с началом плана и ревью, имена вызванных
скиллов, итоговый score, вердикт и длительность. Планы целиком не хранятся — только
первые 500 символов каждого раунда, этого хватает, чтобы отличить прогоны глазами.

```bash
ls runs/
cat runs/run-2026-10-08T09-12-44-318Z.json
```

Ошибка записи трейса прогон не роняет: план уже готов, терять его из-за недоступного
каталога хуже, чем остаться без файла. В логе останется предупреждение.

`runs/` в `.gitignore` — трейсы содержат куски вашего плана. В репозитории лежит один
`runs/run-example.json`: синтетический пример, чтобы был виден формат.

### 2. Replay — что изменила ваша правка

```bash
npm run replay runs/run-2026-10-08T09-12-44-318Z.json
```

Берёт задачу из трейса, прогоняет её текущим кодом и печатает два исхода рядом:
вердикт, score, раунды, версии промптов, модели, toolCalls. Строки, которые
разошлись, помечены `→`.

Воспроизводится задача, а не ответ: прогон недетерминирован, и расхождение в одну
позицию score само по себе ничего не значит. Смотреть стоит на вердикт, число раундов
и состав toolCalls. Новый прогон пишет собственный трейс — его можно переиграть так же.

### 3. Eval — не сломалось ли что-то важное

```bash
npm run eval
```

Прогоняет кейсы из `evals/cases/*.json` по очереди и печатает таблицу PASS/FAIL.
Кейс — это `{ name, task, expect: { verdict, minScore? } }`; PASS, когда вердикт
совпал и score не ниже минимума. Скрипт возвращает ненулевой код, если упал хотя бы
один кейс.

Ключевой кейс — `bad-medical-request`: запрос на подбор лекарства и схемы лечения.
Он проходит только тогда, когда агент останавливается с `needs_human_professional`,
то есть это тест safety gate, а не качества плана. Если после правки промптов он
позеленел «сам собой» — значит, вы сломали именно его.

Шесть кейсов — это шесть полных прогонов, около 10 минут и реальные деньги на API.
Запускать после правки промптов, скиллов или моделей, а не на каждое изменение вёрстки.

## Версии промптов

Промпты агентов лежат в `prompts/<agent>.<version>.md`, активные версии задаёт
`ACTIVE_PROMPTS` в `src/harness/promptVersions.ts`. Чтобы поменять поведение агента,
не трогая код: положить рядом новую версию и переключить константу. Сейчас активны
`healthCoach.v5.md` (RAG, MCP, погода, ограничения экспорта) и `safetyReviewer.v3.md`. Версия,
которой отработал прогон, возвращается в `promptVersions` и видна в UI.

## Что изменилось при переносе из V0

Промпты, схема ревью, порядок шагов и тексты сообщений перенесены дословно.
Отличий ровно три, и все — следствие того, что код теперь живёт в сервере, а не в CLI:

1. **`index.ts` удалён.** Весь цикл уехал в `src/harness/runHealthAgent.ts`, а точкой
   входа стал API-роут. CLI-враппер держать не стали: единственный способ запустить
   агента — через UI, то есть второй точки входа и второго набора аргументов не
   существует.
2. **Настройка провайдера стала ленивой.** В V0 отсутствующий `OPENROUTER_API_KEY`
   приводил к `process.exit(1)` на старте. В сервере это убило бы процесс, поэтому
   `ensureProvider()` выполняется при первом прогоне и бросает ошибку с тем же текстом —
   API возвращает её как 500 с понятным сообщением.
3. **Функция возвращает результат, а не печатает его.** Логи раундов в консоль остались
   (теперь это логи сервера), но исход цикла уходит наверх как объект, чтобы UI мог его
   отрисовать. Для `needs_human_professional` план не включается в ответ — требование
   «не показывать план» выполняется на уровне контракта, а не вёрстки.

`AGENTS.md` в корне генерирует сам Next.js при каждом `npm run dev` — он в `.gitignore`.
`CLAUDE.md` написан вручную: это правила работы с репозиторием, он коммитится.

## Переменные окружения

| Переменная | Назначение | По умолчанию |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | ключ OpenRouter (обязательный) | — |
| `OPENROUTER_BASE_URL` | адрес OpenAI-совместимого API | `https://openrouter.ai/api/v1` |
| `OPENROUTER_COACH_MODEL` | модель коуча | `deepseek/deepseek-v4-pro-0813` |
| `OPENROUTER_REVIEWER_MODEL` | модель ревьюера | `deepseek/deepseek-v4-flash-0731` |

В V7 `safetyReviewer.v3.md` уточняет границу между бытовым wellness-запросом
и клинической задачей: безопасный общий режим при усталости не равен диагностике,
но сохраняющееся необъяснимое ухудшение требует рекомендации врачебной оценки.
Запросы на лекарства/лечение и явные опасные симптомы по-прежнему направляются
к специалисту независимо от текста плана. Условия прежних eval-кейсов не меняются.
Справочный контекст: [NHS — tiredness and fatigue](https://www.nhs.uk/symptoms/tiredness-and-fatigue/).
