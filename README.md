# Health Coach Agent

Коуч по образу жизни (питание, тренировки, восстановление) с обязательной проверкой
плана вторым агентом. В V5 данные доступны через собственный MCP-сервер по stdio;
цикл ревью, оценки, traces, replay и evals остаются в harness.

## Запуск

```bash
cp .env.example .env   # вписать OPENROUTER_API_KEY
npm install
npm run dev            # http://localhost:3000
```

Ввести задачу в текстовое поле, нажать **Run Agent**. Один запрос — один ответ,
без чата и истории. Прогон занимает 1–4 минуты: каждый раунд это два обращения к модели.

UI собран на Tailwind v4 и shadcn/ui, тема — светлая cyan-green. Правила по стилю,
токенам и структуре лежат в `CLAUDE.md`.

## Структура

```
app/page.tsx                  UI: форма, состояния idle/running/result/error
app/layout.tsx                корневой layout: шрифт Inter, globals.css, skip-link
app/globals.css               Tailwind v4 и токены темы
app/api/agent/run/route.ts    POST { task } → { plan, review, rounds }
components/ui/*               примитивы shadcn/ui
components/health/review-widgets.tsx  виджеты ревью, история раундов, метаданные прогона
lib/utils.ts                  cn(): clsx + tailwind-merge
prompts/*.v*.md               системные промпты агентов, по файлу на версию
src/agents/healthCoach.ts     фабрика коуча: модель, локальные tools, mcpServers
src/agents/safetyReviewer.ts  фабрика агента-ревьюера: имя и модель, tools нет намеренно
src/mcp/markdownHealthServer.ts  отдельный MCP-процесс: пять tools, четыре resources
src/mcp/markdownStore.ts      операции с markdown: чтение, добавление записи, сохранение
src/mcp/healthMcp.ts          stdio-клиент Agents SDK, фильтрация tools, чтение resources
src/skills/*.ts               локальные shopping/workouts + файловый helper
src/harness/runHealthAgent.ts оркестратор: провайдер, цикл коуч ↔ ревьюер, фазы tools
src/harness/validateReview.ts схема ревью, разбор JSON и один ретрай
src/harness/rounds.ts         RoundState и история раундов
src/harness/score.ts          итоговый score и флаг improved
src/harness/promptVersions.ts загрузка промптов и ACTIVE_PROMPTS
src/harness/toolCalls.ts      имена вызванных tools из результата прогона
src/harness/traceRun.ts       запись трейса прогона в runs/<runId>.json
scripts/replay.ts             повтор задачи из трейса текущим кодом
scripts/eval.ts               прогон кейсов из evals/cases и таблица PASS/FAIL
scripts/mcpInspect.ts         список MCP tools и resources без вызовов модели
evals/cases/*.json            кейсы: { name, task, expect }
runs/*.json                   трейсы прогонов (в .gitignore, кроме run-example.json)
data/profile.md               профиль пользователя (MCP)
data/log.md                   дневник: чтение и добавление записей (MCP)
data/recipes.md               любимые рецепты (MCP)
data/output.md                последний одобренный план (выход)
data/shopping.md              список покупок к плану (выход)
```

## Флоу

1. UI шлёт `POST /api/agent/run` с `{ task }`.
2. `runHealthAgent(task)` запускает MCP-процесс и передаёт коучу только задачу.
   Коуч достаёт профиль, дневник и рецепты через MCP tools. Harness читает
   `profile://me` и `logs://recent`, чтобы передать ревьюеру фиксированный контекст.
3. До трёх раундов: коуч пишет план → ревьюер возвращает JSON `{ verdict, score, issues }`.
   Невалидный JSON — один ретрай, второй подряд — ошибка.
4. Развилка по вердикту:
   - `approve` — отдельная конфигурация коуча получает только `save_health_plan`,
     сохраняет план через MCP в `data/output.md`, план уходит в UI;
   - `needs_human_professional` — план не сохраняется и **не отдаётся** (`plan: null`),
     UI показывает предупреждение «Этот запрос требует консультации специалиста»;
   - `revise` — замечания уходят коучу на следующий раунд; если три раунда прошли
     без одобрения, UI показывает последний план с вердиктом `revise`.
5. В `finally` harness закрывает MCP-соединение и дочерний процесс, в том числе
   при ошибке. Ошибка сохранения плана, как и раньше, не отменяет готовый ответ;
   предупреждение остаётся в серверном логе.

Ответ API:

```ts
{
  plan: string | null,
  review: { verdict, score, issues },   // ревью последнего раунда
  rounds: { round, plan, review }[],    // трейс всех раундов
  toolCalls: string[],                  // имена локальных и MCP tools, по порядку
  finalScore: number | null,            // score последнего approve
  improved: boolean,                    // вырос ли score на последней ревизии
  promptVersions: { coach: string, reviewer: string },
  durationMs: number
}
```

`maxRounds` — второй параметр `runHealthAgent(task, maxRounds = 3)`.

## До MCP / После MCP

| До MCP (V3–V4) | После MCP (V5) |
| --- | --- |
| Каждая интеграция подключалась вручную: импорт функции, Zod-обёртка `tool()`, массив tools агента. | Агент получает `mcpServers: [server]`; Agents SDK обнаруживает схемы tools и вызывает их по стандартному протоколу. |
| Профиль, дневник, рецепты и запись плана выполнялись внутри процесса приложения. | Операции с markdown выполняет отдельный процесс `markdownHealthServer.ts`, связь — stdin/stdout JSON-RPC. |
| Контекст ревьюера читался прямыми функциями. | Harness читает MCP resources и передаёт ревьюеру текст; у ревьюера по-прежнему нет tools. |
| Переиспользование интеграции требовало знания модулей этого приложения. | Любой совместимый MCP-клиент может обнаружить tools/resources сервера без импорта кода агента. |

Внутри сервера операции с файлами по-прежнему реализованы явно. MCP стандартизирует
обнаружение и вызов интеграции, а не пишет её за нас. Два локальных tools,
`generateShoppingList` и `suggestWorkoutTemplate`, намеренно оставлены для сравнения.
Все инструменты модели попадают в один `toolCalls`: например,
`read_profile → read_recent_logs → list_recipes → generateShoppingList → save_health_plan`.
Чтение resources самим harness туда не попадает: это не вызов инструмента моделью.
В UI каждый известный вызов отмечен меткой `MCP` или `Локальный`, рядом остаётся
точное имя инструмента. Старые прямые profile/logs/plans/recipes tools удалены;
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

Фильтр `toolFilter` в `src/mcp/healthMcp.ts` скрывает `save_health_plan` от
генератора и открывает только его агенту `Health Coach Saver` после `approve`.
В этой фазе выставлены `toolChoice: "required"` и `stop_on_first_tool`, чтобы
сохранение не повторялось. Сам MCP-сервер предоставляет все пять tools клиенту:
порядок ревью контролирует harness, это не авторизация для посторонних клиентов.
Клиент проверяет `isError` в ответе MCP и поднимает исключение: неудачная запись
не должна выглядеть как успешно сохранённый план.

### Демо без модели

```bash
npm run mcp:inspect
```

Команда запускает сервер, печатает пять tools с JSON-схемами и четыре URI resources,
затем закрывает процесс. Ключ OpenRouter не нужен, содержимое личных файлов не выводится.
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
У серверов нет HTTP/SSE-транспортов, портов, внешних MCP-сервисов и отдельного демона.

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

Пять кейсов — это пять полных прогонов, около 10 минут и реальные деньги на API.
Запускать после правки промптов, скиллов или моделей, а не на каждое изменение вёрстки.

## Версии промптов

Промпты агентов лежат в `prompts/<agent>.<version>.md`, активные версии задаёт
`ACTIVE_PROMPTS` в `src/harness/promptVersions.ts`. Чтобы поменять поведение агента,
не трогая код: положить рядом новую версию и переключить константу. Сейчас активны
`healthCoach.v3.md` (MCP + локальные tools) и `safetyReviewer.v2.md`. Версия,
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
