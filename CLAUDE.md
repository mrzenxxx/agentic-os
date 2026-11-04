@AGENTS.md

# Repository Guidelines

## Структура проекта и модули

Это локальное Next.js App Router приложение для запуска Health Coach Agent через веб-интерфейс.

- `app/page.tsx` — клиентская страница с textarea, кнопкой запуска и блоком результата (на shadcn/ui).
- `app/layout.tsx` — root layout, подключает шрифт `Inter` через `next/font`, `globals.css` и skip-link.
- `app/globals.css` — Tailwind v4 + дизайн-токены темы (см. «Дизайн-система и UI»).
- `app/api/agent/run/route.ts` — POST endpoint `/api/agent/run`, вызывает harness.
- `components/ui/*` — примитивы shadcn/ui (button, card, badge, alert, textarea, label, skeleton, separator).
- `components/health/review-widgets.tsx` — презентационные виджеты ревью: `VerdictBadge`, `ScoreMeter`, `RoundsIndicator`, `RoundsHistory`, `RunMeta`, `ToolCallsList`, `verdictConfig`.
- `lib/utils.ts` — хелпер `cn()` (clsx + tailwind-merge) для shadcn.
- `components.json` — конфиг shadcn CLI (base `radix`, preset `nova`, alias `@/*`).
- `next.config.ts` — задаёт `turbopack.root`, чтобы сборщик не искал lockfile выше репозитория.
- `postcss.config.mjs` — подключает `@tailwindcss/postcss`.
- `src/agents/healthCoach.ts` и `src/agents/safetyReviewer.ts` — фабрики агентов: имя, модель и ничего больше. Промпт и набор tools приходят параметрами.
- `src/skills/*.ts` — локальные shopping/workouts: функция + обёртка `tool()` с Zod-схемой. `index.ts` — массив `PLANNING_TOOLS`, `dataFile.ts` — файловый helper.
- `src/mcp/markdownHealthServer.ts` — свой stdio MCP-сервер: пять tools и четыре resources поверх markdown.
- `src/mcp/markdownStore.ts` — операции с profile/logs/recipes/output, включая добавление записи дневника.
- `src/mcp/servers.config.ts` — массив описаний stdio MCP-серверов: name/command/args/env/enabled.
- `src/mcp/serverRegistry.ts` — создание клиентов, запуск/закрытие всех процессов, фазовый фильтр.
- `src/mcp/healthMcp.ts` — клиент своего сервера, проверка isError, фильтрация, чтение resources.
- `src/mcp/reviewerContext.ts` — контекст ревьюера через resources или fallback filesystem MCP.
- `src/mcp/toolIdentity.ts` — общий разбор имени/источника инструмента для trace и UI.
- `src/harness/runHealthAgent.ts` — оркестратор: настройка провайдера, цикл coach/reviewer, развилка по вердикту, выбор набора tools по фазе прогона.
- `src/harness/validateReview.ts` — Zod-схема ревью, разбор «грязного» JSON и один ретрай.
- `src/harness/rounds.ts` — `RoundState` и история раундов прогона.
- `src/harness/score.ts` — итоговый score (последний approve) и флаг `improved`.
- `src/harness/promptVersions.ts` — загрузка промптов из файлов и константа `ACTIVE_PROMPTS`.
- `src/harness/toolCalls.ts` — извлечение имён вызванных tools из результата прогона.
- `src/harness/traceRun.ts` — сборка и запись трейса прогона в `runs/<runId>.json`.
- `scripts/replay.ts` и `scripts/eval.ts` — повтор задачи из трейса и прогон кейсов. Запускаются через `tsx`, сборки не требуют.
- `evals/cases/*.json` — кейсы для `npm run eval`: `{ name, task, expect: { verdict, minScore? } }`.
- `runs/*.json` — трейсы прогонов. Каталог в `.gitignore`, в репозитории лежит только синтетический `runs/run-example.json` как образец формата.
- `prompts/<agent>.<version>.md` — системные промпты агентов. Новая версия = новый файл + смена `ACTIVE_PROMPTS`, код не трогаем.
- `data/profile.md`, `data/log.md`, `data/recipes.md` — локальный контекст, читается через MCP; дневник дополняется через `append_daily_log`.
- `data/output.md` — последний одобренный план (MCP); `data/shopping.md` — список покупок (локальный tool).
- `plans/*.md` — дополнительные копии планов через filesystem MCP; личные файлы игнорируются Git.
- `AGENTS.md` генерирует сам Next.js при каждом `npm run dev`, он в `.gitignore`; правки туда вносить бессмысленно.
- Тестовой директории сейчас нет; статические ассеты тоже не используются.

## Команды разработки, сборки и запуска

- `npm run dev` — запускает локальный Next.js dev server на `http://localhost:3000`.
- `npm run build` — проверяет TypeScript и собирает production bundle.
- `npm run start` — запускает production server после успешной сборки.
- `npm install` — восстанавливает зависимости из `package-lock.json`.
- `npm run replay runs/run-<timestamp>.json` — повторяет задачу из трейса текущим кодом и печатает diff «было / стало».
- `npm run eval` — прогоняет кейсы из `evals/cases/`, печатает таблицу PASS/FAIL, возвращает ненулевой код при падении кейса. Пять полных прогонов: ~10 минут и реальные деньги на API.
- `npm run mcp:inspect` — запускает enabled stdio-серверы, печатает tools/resources, закрывает процессы; ключ модели не нужен. `npm run mcp:inspect -- --read profile://me` читает markdown resource по URI; `--server weather` выбирает сервер.

Отдельного CLI entrypoint нет: работаем только через интерфейс и API route.

## Стиль кода и соглашения

Проект использует TypeScript, ESM и `strict` режим. Соблюдайте 2 пробела, именуйте React-компоненты в `PascalCase`, функции и переменные в `camelCase`, типы в `PascalCase`. Для runtime validation используйте Zod, как в `ReviewSchema`. Сохраняйте существующий стиль: небольшие focused-файлы, явные типы на публичных результатах.

UI строится на **Tailwind CSS v4 + shadcn/ui**. Стилизуйте через utility-классы Tailwind и семантические токены темы (`bg-background`, `text-foreground`, `bg-primary` и т.п.), а не через inline styles или сырой hex. Классы объединяйте через `cn()` из `lib/utils.ts`. Иконки — только из `lucide-react` (никаких emoji). Новые примитивы добавляйте через `npx shadcn@latest add <component>` в `components/ui/`; составные виджеты — в `components/health/`.

Одна особенность CLI: сгенерированные примитивы импортируют `cn` из пакета `cn`. После каждого `shadcn add` переписывайте импорт на `@/lib/utils`, чтобы в проекте оставалась одна реализация `cn()`.

## Дизайн-система и UI

Направление — **Calm cyan-green (health-tech)**, только светлая тема (dark mode намеренно не добавлен).

- **Стек:** Tailwind v4 (`@tailwindcss/postcss`, CSS-first), shadcn/ui (base `radix`, preset `nova`), `lucide-react`, шрифт `Inter` (`next/font`, переменная `--font-inter`).
- **Токены:** объявлены в `:root` внутри `app/globals.css` и проброшены в Tailwind через `@theme inline`. Базовая палитра — cyan (`--primary #0e7490`) на светлом cyan-фоне (`--background #f5fbfc`), текст `--foreground #123c49`. Значения подобраны под контраст WCAG AA. Меняйте цвета только здесь, не в компонентах.
- **Dark mode:** вариант `dark` объявлен через `@custom-variant`, но переопределений токенов нет. Это осознанно: утилиты `dark:*` в примитивах shadcn компилируются и остаются мёртвыми, вместо того чтобы срабатывать от системной темы и ломать палитру.
- **Семантика статусов:** цвет вердикта передаётся цветом + иконкой + текстом (правило `color-not-only`). Маппинг живёт в `verdictConfig` (`components/health/review-widgets.tsx`): `approve` → emerald, `revise` → amber, `needs_human_professional` → red. Для статусов используются встроенные шкалы Tailwind (emerald/amber/red), а не кастомные токены.
- **Информативность результата:** `ScoreMeter` (индикатор 0–10 с цветом по порогу и `role="meter"`), `RoundsIndicator` (раунды ревью), `ReviewIssues` (замечания ревьюера, свёрнутые по умолчанию — это трейс проверки, а не часть ответа; разворачиваются сами только при `needs_human_professional`), `ToolCallsList` («Что сделал агент»), `RunMeta` (длительность прогона и версии промптов), `RoundsHistory` (свёрнутая история раундов), кнопка «Копировать» плана. Loading использует `Skeleton`; empty-state — нумерованные шаги ревью.
- **A11y:** skip-link в layout, `aria-live` на статусе, видимые focus-ring, touch-friendly CTA (`size="lg"` + `min-h-11`), уважается `prefers-reduced-motion`. Пустая задача даёт inline-ошибку рядом с полем, а не отключённую кнопку.

При правках UI придерживайтесь чек-листа: контраст ≥4.5:1, один primary-CTA на экран, transitions 150–300 мс, проверка на 375/768/1024/1440 px без горизонтального скролла.

## Скиллы и tools

Контекст в промпт коуча не вклеивается: профиль, дневник и рецепты агент достаёт через MCP tools. Локальные tools и MCP tools для модели — одинаковые function calls.

- Один скилл — один файл в `src/skills/`: чистая функция (её можно звать из харнесса мимо модели) и её обёртка в `tool()` с Zod-схемой параметров.
- Описание tool'а — это интерфейс для модели, а не комментарий. Пишите в нём не только «что отдаёт», но и «когда вызывать» и «чего там нет», иначе модель дёргает инструмент не к месту или не дёргает вовсе.
- `PLANNING_TOOLS` в `src/skills/index.ts` содержит только shopping/workouts. MCP tools подключаются через `mcpServers`, без ручных обёрток в `tool()`.
- Каждый enabled MCP-сервер живёт отдельным stdio-процессом на прогон; все соединения закрываются в `finally`, включая ошибки частичного запуска. Конфиг — единственное место добавления интеграций, внешние tools без своих обёрток. `tsx` требуется во время выполнения, не только разработки. stdout сервера — только JSON-RPC, логи — stderr. Сетевые MCP-транспорты не добавлять.
- **Tools только у коуча.** У Safety Reviewer их нет и быть не должно: вердикт обязан быть функцией входа, а сторона, одобряющая запись, сама на диск не пишет. Подробнее — в комментарии `src/agents/safetyReviewer.ts`.
- **Запись плана гейтит harness.** `save_health_plan` скрыт от планировщика; внешние tools доступны до approve только с MCP-аннотацией `readOnlyHint: true` (без аннотации — после approve). После approve `Health Coach Saver` получает только обязательный save_health_plan с required/stop_on_first_tool. Затем `Health Coach Exporter` получает внешние tools записи для дополнительных копий. У exporter нет save_health_plan; append_daily_log скрыт от обоих. Фаза заранее создаёт публичный RunState и сохраняет частичные toolCalls через RunResult(state), в том числе при сетевой ошибке. Аннотации — подсказки сервера, не замена allowed directories/правам integration.
- **Промпт — просьба, конфиг — стена.** Filesystem запускается только для абсолютных data/ и plans/, с `--confine-roots`; не расширять до корня проекта. Notion включается по непустому NOTION_TOKEN, права internal integration только на Wellness. Weather — read-only Open-Meteo, без ключа. Все транспорты stdio; OAuth не добавлять.
- Погодный город брать из profile.md, координаты получать готовым geocoding tool. Не хардкодить локацию в коде. Активен `healthCoach.v4.md`: прогноз для тренировок на улице, перенос в помещение при плохой погоде, ограничения экспорта. Новые изменения промпта — новым файлом версии.
- Ревьюер не подключён к MCP. Harness читает `profile://me` и `logs://recent` (7 записей) и передаёт ему текст; при отключённом markdown-health читает профиль и последние 200 строк дневника через filesystem, если он включён; если выключены оба — указывает отсутствие источника. Это не tool calls модели и не добавляется в `toolCalls`.
- `append_daily_log` дописывает запись с датой UTC, только по просьбе пользователя записать реальные факты. План нельзя выдавать за выполненный день. `read_recent_logs.days` — число последних записей (1–30), не календарное окно.
- Имена вызванных инструментов собираются из результата прогона (`src/harness/toolCalls.ts`), уходят в `HealthAgentResult.toolCalls` как `[источник] tool` и показываются в UI блоком «Что сделал агент» с меткой сервера или local. SDK сам добавляет namespace к tools; общий toolIdentity преобразует имена для trace/UI. `saveSummary` показывает фактический отчёт о записи отдельно от проверенного плана. Скиллы о том, что их считают, не знают.

## Тестирование

Автоматические тесты пока не настроены. Перед сдачей изменений минимум запускайте `npm run build` (он же прогоняет TypeScript). Для изменений UI вручную проверьте `npm run dev`: idle, running (skeleton + спиннер на кнопке), result (score-meter, раунды, замечания, «Копировать»), warning при `needs_human_professional`, а также error (пустая задача / отсутствие ключа). Для изменений harness проверьте, что одобренный план записывается в `data/output.md`, а результат содержит `rounds`, `toolCalls`, `finalScore`, `promptVersions` и `durationMs`. Для изменений скиллов — что в `toolCalls` попали ожидаемые имена и что побочные файлы (`data/shopping.md`) обновились.
При написании кода агентом не пиши тесты и не используй TDD.

## Коммиты и pull request

Используйте простые Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`. В PR указывайте цель, изменённые файлы, команды проверки и скриншот для UI-изменений. Отдельно отмечайте любые изменения промптов, safety logic или формата API-ответа.

## Безопасность и конфигурация агентов

Секреты храните только в `.env`, не коммитьте его. Провайдер — OpenRouter как OpenAI-совместимый шлюз к DeepSeek, поэтому переменные называются по шлюзу:

| Переменная | Назначение | По умолчанию |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | ключ OpenRouter (обязательный) | — |
| `OPENROUTER_BASE_URL` | адрес OpenAI-совместимого API | `https://openrouter.ai/api/v1` |
| `OPENROUTER_COACH_MODEL` | модель коуча | `deepseek/deepseek-v4-pro-0813` |
| `OPENROUTER_REVIEWER_MODEL` | модель ревьюера | `deepseek/deepseek-v4-flash-0731` |

Модели у коуча и ревьюера разные намеренно: генерация плана сложнее, чем ревью по чек-листу с готовым JSON-ответом, поэтому ревьюер сидит на более дешёвой модели.

Не добавляйте авторизацию, БД, историю сообщений, streaming или новые способности агентов без явного требования. Для внешних MCP достаточно записи в конфиге; не добавлять switch по новым серверам в harness. Промпты и revision loop меняйте только осознанно: это основная бизнес-логика проекта. Промпты правятся не на месте, а новой версией файла в `prompts/` — так прежнее поведение остаётся воспроизводимым, а в результате прогона видно, какой версией он отработал.

Харнесс пишет на диск только трейс прогона в `runs/`; MCP-сервер пишет `data/output.md` и дополняет `data/log.md`, локальный shopping tool пишет `data/shopping.md`, filesystem MCP может писать в `data/` и `plans/`, Notion — в выделенную Wellness по явному запросу. Трейсы локальные и только в JSON: Langfuse, OpenTelemetry и прочие внешние сервисы сюда не заводим. Ошибка записи трейса не должна ронять прогон — план уже сгенерирован, и терять его из-за диска хуже, чем остаться без трейса.

## Принципы кодовой базы

- Поддерживать кодовую базу в высокомодульном состоянии и с хорошей документацией.
- Следовать принципу «разделения ответственности» (separation of concerns).
