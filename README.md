# Health Coach Agent

Коуч по образу жизни (питание, тренировки, восстановление) с обязательной проверкой
плана вторым агентом. Логика агентов не менялась — V1 это тот же цикл из V0,
разложенный по файлам и завёрнутый в Next.js.

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
prompts/*.v1.md               системные промпты агентов, по файлу на версию
src/agents/healthCoach.ts     фабрика агента-коуча: имя и модель
src/agents/safetyReviewer.ts  фабрика агента-ревьюера: имя и модель
src/harness/runHealthAgent.ts оркестратор: провайдер, цикл коуч ↔ ревьюер, трейс
src/harness/validateReview.ts схема ревью, разбор JSON и один ретрай
src/harness/rounds.ts         RoundState и история раундов
src/harness/score.ts          итоговый score и флаг improved
src/harness/promptVersions.ts загрузка промптов и ACTIVE_PROMPTS
data/profile.md               профиль пользователя (вход)
data/log.md                   дневник (вход)
data/output.md                последний одобренный план (выход)
```

## Флоу

1. UI шлёт `POST /api/agent/run` с `{ task }`.
2. `runHealthAgent(task)` читает `data/profile.md` и `data/log.md`, собирает контекст.
3. До трёх раундов: коуч пишет план → ревьюер возвращает JSON `{ verdict, score, issues }`.
   Невалидный JSON — один ретрай, второй подряд — ошибка.
4. Развилка по вердикту:
   - `approve` — план сохраняется в `data/output.md` и уходит в UI;
   - `needs_human_professional` — план не сохраняется и **не отдаётся** (`plan: null`),
     UI показывает предупреждение «Этот запрос требует консультации специалиста»;
   - `revise` — замечания уходят коучу на следующий раунд; если три раунда прошли
     без одобрения, UI показывает последний план с вердиктом `revise`.

Ответ API:

```ts
{
  plan: string | null,
  review: { verdict, score, issues },   // ревью последнего раунда
  rounds: { round, plan, review }[],    // трейс всех раундов
  finalScore: number | null,            // score последнего approve
  improved: boolean,                    // вырос ли score на последней ревизии
  promptVersions: { coach: string, reviewer: string },
  durationMs: number
}
```

`maxRounds` — второй параметр `runHealthAgent(task, maxRounds = 3)`.

## Версии промптов

Промпты агентов лежат в `prompts/<agent>.<version>.md`, активные версии задаёт
`ACTIVE_PROMPTS` в `src/harness/promptVersions.ts`. Чтобы поменять поведение агента,
не трогая код: положить рядом `healthCoach.v2.md` и переключить константу. Версия,
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
