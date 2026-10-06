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
- `src/skills/*.ts` — скиллы коуча: чистая функция + её обёртка в `tool()` с Zod-схемой. По файлу на скилл, `index.ts` — два простых массива наборов.
- `src/harness/runHealthAgent.ts` — оркестратор: настройка провайдера, цикл coach/reviewer, развилка по вердикту, выбор набора tools по фазе прогона.
- `src/harness/validateReview.ts` — Zod-схема ревью, разбор «грязного» JSON и один ретрай.
- `src/harness/rounds.ts` — `RoundState` и история раундов прогона.
- `src/harness/score.ts` — итоговый score (последний approve) и флаг `improved`.
- `src/harness/promptVersions.ts` — загрузка промптов из файлов и константа `ACTIVE_PROMPTS`.
- `src/harness/toolCalls.ts` — извлечение имён вызванных tools из результата прогона.
- `prompts/<agent>.<version>.md` — системные промпты агентов. Новая версия = новый файл + смена `ACTIVE_PROMPTS`, код не трогаем.
- `data/profile.md`, `data/log.md`, `data/recipes.md` — локальный контекст: профиль, дневник, любимые рецепты. Читаются только скиллами.
- `data/output.md`, `data/shopping.md` — результаты работы скиллов: последний одобренный план и список покупок к нему.
- `AGENTS.md` генерирует сам Next.js при каждом `npm run dev`, он в `.gitignore`; правки туда вносить бессмысленно.
- Тестовой директории сейчас нет; статические ассеты тоже не используются.

## Команды разработки, сборки и запуска

- `npm run dev` — запускает локальный Next.js dev server на `http://localhost:3000`.
- `npm run build` — проверяет TypeScript и собирает production bundle.
- `npm run start` — запускает production server после успешной сборки.
- `npm install` — восстанавливает зависимости из `package-lock.json`.

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

Контекст в промпт коуча не вклеивается: профиль, дневник и рецепты агент достаёт сам, вызывая инструменты (function calling через OpenAI Agents SDK).

- Один скилл — один файл в `src/skills/`: чистая функция (её можно звать из харнесса мимо модели) и её обёртка в `tool()` с Zod-схемой параметров.
- Описание tool'а — это интерфейс для модели, а не комментарий. Пишите в нём не только «что отдаёт», но и «когда вызывать» и «чего там нет», иначе модель дёргает инструмент не к месту или не дёргает вовсе.
- Наборы инструментов — два простых массива в `src/skills/index.ts`: `PLANNING_TOOLS` и `SAVING_TOOLS`. Реестра и плагинной системы нет и не нужно.
- **Tools только у коуча.** У Safety Reviewer их нет и быть не должно: вердикт обязан быть функцией входа, а сторона, одобряющая запись, сама на диск не пишет. Подробнее — в комментарии `src/agents/safetyReviewer.ts`.
- **`savePlan` гейтит харнесс, а не промпт.** На раундах генерации коуч собирается без `savePlanTool` — вызвать то, чего не показали, модель не может. После approve харнесс поднимает коуча второй конфигурацией (`SAVING_TOOLS`, `toolChoice: "required"`) и делает один короткий вызов. Инвариант «на диск попадает только одобренный план» держится кодом. Подробнее — в комментарии `src/skills/plans.ts`.
- Имена вызванных инструментов собираются из результата прогона (`src/harness/toolCalls.ts`), уходят в `HealthAgentResult.toolCalls` и показываются в UI блоком «Что сделал агент». Скиллы о том, что их считают, не знают.

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

Не добавляйте авторизацию, БД, историю сообщений, streaming или новые способности агентов без явного требования. Промпты и revision loop меняйте только осознанно: это основная бизнес-логика проекта. Промпты правятся не на месте, а новой версией файла в `prompts/` — так прежнее поведение остаётся воспроизводимым, а в результате прогона видно, какой версией он отработал.

Харнесс ничего не пишет на диск, кроме `data/output.md`: персистентности трейсов пока нет намеренно.

## Принципы кодовой базы

- Поддерживать кодовую базу в высокомодульном состоянии и с хорошей документацией.
- Следовать принципу «разделения ответственности» (separation of concerns).
