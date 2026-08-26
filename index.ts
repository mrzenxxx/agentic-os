import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// ПРОВАЙДЕР: OpenRouter через OpenAI-совместимый API
//
// Agents SDK не умеет ходить в OpenRouter напрямую — он умеет ходить в «клиент
// OpenAI SDK». Поэтому подменяем сам клиент: создаём обычный OpenAI-клиент, но
// с чужим baseURL и чужим ключом. Для SDK это по-прежнему «OpenAI», по факту —
// OpenRouter, который проксирует запрос в DeepSeek.
// ─────────────────────────────────────────────────────────────────────────────

// new OpenAI({...}) — HTTP-клиент официального openai-пакета. Он не делает
// запросов при создании, только хранит настройки: куда стучаться (baseURL),
// чем авторизоваться (apiKey), таймауты и ретраи. Все вызовы вида
// client.chat.completions.create(...) уйдут на baseURL + "/chat/completions".
if (!process.env.OPENROUTER_API_KEY) {
  // openai-пакет бросает исключение прямо в конструкторе, если ключа нет —
  // проверяем заранее, чтобы вместо стектрейса показать понятную подсказку.
  console.error("Не задан OPENROUTER_API_KEY в .env (см. .env.example)");
  process.exit(1);
}

const client = new OpenAI({
  baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY, // ключ OpenRouter из .env
});

// setDefaultOpenAIClient(client) — кладёт клиент в глобальный реестр SDK.
// Дальше любой Agent, у которого модель задана строкой (а не объектом Model),
// будет резолвиться через этот клиент. Без вызова SDK создал бы клиент сам,
// взял бы OPENAI_API_KEY и ушёл на api.openai.com.
setDefaultOpenAIClient(client);

// setOpenAIAPI("chat_completions") — переключает протокол общения с моделью.
// По умолчанию SDK использует OpenAI Responses API (/responses) — его нет ни у
// OpenRouter, ни у DeepSeek. Этот вызов заставляет SDK собирать запросы в
// формате Chat Completions (/chat/completions): messages[], role/content —
// то, что понимает почти любой OpenAI-совместимый провайдер.
setOpenAIAPI("chat_completions");

// setTracingDisabled(true) — выключает встроенный экспорт трейсов. По умолчанию
// SDK шлёт телеметрию прогонов на платформу OpenAI, а для этого нужен ключ
// OpenAI, которого у нас нет: без выключения в консоль сыпались бы 401.
setTracingDisabled(true);

// Модели в формате OpenRouter: "<вендор>/<модель>". Разные для двух ролей:
// генерация плана — задача сложнее, ревью по чек-листу с готовым JSON-ответом
// проще, поэтому ревьюер сидит на flash (примерно в 20 раз дешевле pro).
// Список актуальных id: https://openrouter.ai/api/v1/models
const COACH_MODEL = process.env.OPENROUTER_COACH_MODEL ?? "deepseek/deepseek-v4-pro-0813";
const REVIEWER_MODEL = process.env.OPENROUTER_REVIEWER_MODEL ?? "deepseek/deepseek-v4-flash-0731";

// --- Системные промпты ---
const COACH_PROMPT = `Ты — Health Coach: тренер по образу жизни (питание, тренировки, восстановление, привычки).
Ты работаешь только с контекстом из профиля и дневника пользователя — других данных у тебя нет.

Формат плана (markdown):
1. **Кратко** — 2–3 строки: что за план и на чём фокус.
2. **План по пунктам** — конкретика: продукты и граммовки, упражнения с подходами, время дня.
3. **Почему так** — привязка к профилю и записям дневника (сон, тренировки, еда последних дней).
4. **На что смотреть** — 2–3 сигнала самочувствия, при которых план стоит скорректировать.

Жёсткие правила:
- Никаких диагнозов, трактовки симптомов и анализов, назначения или подбора лекарств, БАДов в лечебных дозах, схем терапии.
- Если запрос уходит в медицину — не выполняй его: скажи, что это к врачу, и предложи то, что в твоей зоне (питание, режим, нагрузка).
- Учитывай ограничения профиля (непереносимости, травмы, нехватку времени) — не предлагай запрещённое.
- Без общих фраз. Никаких резких дефицитов калорий и экстремальных нагрузок.
- Отвечай на русском, только текстом плана, без вопросов пользователю.`;

const REVIEWER_PROMPT = `Ты — Safety Reviewer. Проверяешь план wellness-коуча по трём критериям:
1. Безопасность: нет медицинских советов (диагнозы, лекарства, лечение, трактовка анализов), нет опасных дефицитов калорий, экстремальных нагрузок и практик.
2. Реалистичность: план выполним для обычного человека, укладывается в его расписание, темп изменений умеренный.
3. Соответствие профилю и дневнику: учтены цели, непереносимости, травмы, предпочтения и реальные данные последних дней.

Вердикты:
- "approve" — план безопасен и годен (мелкие замечания допустимы, их пиши в issues).
- "revise" — есть что исправить; в issues дай конкретные требования к правке.
- "needs_human_professional" — сам запрос или план требуют врача/специалиста (лекарства, симптомы, диагностика, лечение, беременность, расстройства пищевого поведения).

Порядок проверки (важно): сначала смотри на ЗАПРОС ПОЛЬЗОВАТЕЛЯ, потом на план.
Если запрос сам по себе медицинский, вердикт — "needs_human_professional", даже если
коуч корректно отказался от медицинской части и выдал безопасный план по образу
жизни: такой запрос должен уйти к врачу, а не быть закрыт планом коуча.

Отвечай ТОЛЬКО валидным JSON, без markdown-обёртки и пояснений:
{"verdict":"approve"|"revise"|"needs_human_professional","score":<число 0-10>,"issues":["..."]}`;

// --- Схема ответа ревьюера ---
const ReviewSchema = z.object({
  verdict: z.enum(["approve", "revise", "needs_human_professional"]),
  score: z.number().min(0).max(10),
  issues: z.array(z.string()),
});
type Review = z.infer<typeof ReviewSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// АГЕНТЫ
//
// new Agent({...}) — это не сетевой вызов и не процесс, а конфигурация одного
// «участника»: кто он, что ему сказано в системном промпте и какой моделью он
// думает. Объект неизменяемый и переиспользуемый: один и тот же агент можно
// гонять сколько угодно раз с разным входом.
//   name         — метка агента (логи, трейсы, передача управления между агентами)
//   instructions — системный промпт: уходит первым сообщением с role: "system"
//   model        — строка-id; резолвится через клиент из setDefaultOpenAIClient,
//                  у каждого агента своя (см. COACH_MODEL / REVIEWER_MODEL)
// Остальные поля Agent (tools, handoffs, outputType, guardrails) намеренно не
// заданы: агентам нечего вызывать, весь контекст приходит текстом из файлов.
// ─────────────────────────────────────────────────────────────────────────────
const coach = new Agent({ name: "Health Coach", instructions: COACH_PROMPT, model: COACH_MODEL });
const reviewer = new Agent({ name: "Safety Reviewer", instructions: REVIEWER_PROMPT, model: REVIEWER_MODEL });

// run(agent, input) — запускает агентный цикл: собирает запрос (system из
// instructions + наш input как сообщение user), шлёт его через клиент, получает
// ответ. Если бы у агента были tools, цикл крутился бы дальше — вызов
// инструмента, результат, повторный запрос к модели — пока модель не выдаст
// финальный текст (не больше maxTurns, по умолчанию 10). У нас инструментов
// нет, поэтому цикл всегда ровно один оборот.
// Возвращает RunResult; нужное поле — finalOutput: текст последнего ответа
// модели (строка, если у агента не задан outputType). Здесь же лежат history,
// newItems и usage — они нам не нужны.
async function ask(agent: Agent, input: string): Promise<string> {
  const result = await run(agent, input);
  return String(result.finalOutput ?? "");
}

// Достаём JSON из ответа модели (иногда приходит в ```json ... ```)
function parseReview(raw: string): Review | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const json = cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1);
  try {
    const parsed = ReviewSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function main() {
  // 1. Задача из CLI
  const task = process.argv[2];
  if (!task) {
    console.error('Использование: npx tsx index.ts "составь план питания на завтра"');
    process.exit(1);
  }

  // 2. Контекст из markdown-файлов
  const profile = readFileSync("profile.md", "utf8");
  const log = readFileSync("log.md", "utf8");
  const context = `# ПРОФИЛЬ\n${profile}\n\n# ДНЕВНИК\n${log}\n\n# ЗАДАЧА\n${task}`;

  let plan = "";
  let issues: string[] = [];

  for (let round = 1; round <= 3; round++) {
    // 3. Коуч генерирует план (со второго раунда — с учётом замечаний ревьюера)
    const coachInput = issues.length
      ? `${context}\n\n# ПРЕДЫДУЩИЙ ПЛАН\n${plan}\n\n# ЗАМЕЧАНИЯ РЕВЬЮЕРА (исправь их и верни план целиком)\n- ${issues.join("\n- ")}`
      : context;
    plan = await ask(coach, coachInput);

    // 4. Ревьюер проверяет план; невалидный JSON — один ретрай.
    // Каждый run() — независимый вызов без общей памяти между агентами, поэтому
    // план передаём ревьюеру текстом внутри input.
    const reviewInput = `# ПРОФИЛЬ\n${profile}\n\n# ДНЕВНИК\n${log}\n\n# ЗАПРОС ПОЛЬЗОВАТЕЛЯ\n${task}\n\n# ПЛАН НА ПРОВЕРКУ\n${plan}`;
    let review = parseReview(await ask(reviewer, reviewInput));
    if (!review) {
      console.log("Ревьюер вернул невалидный JSON — повторный запрос");
      const retry = `${reviewInput}\n\nПРЕДЫДУЩИЙ ОТВЕТ БЫЛ НЕВАЛИДНЫМ. Верни строго JSON по схеме.`;
      review = parseReview(await ask(reviewer, retry));
    }
    if (!review) throw new Error("Ревьюер дважды вернул невалидный JSON");

    console.log(
      `\n[Раунд ${round}] verdict=${review.verdict} score=${review.score}` +
        (review.issues.length ? `\nissues:\n- ${review.issues.join("\n- ")}` : "\nissues: нет"),
    );

    // 5–7. Развилка по вердикту
    if (review.verdict === "needs_human_professional") {
      console.log("\n⛔ Запрос требует живого специалиста (врача). План не сохранён.");
      if (review.issues.length) console.log(`Причины:\n- ${review.issues.join("\n- ")}`);
      return;
    }
    if (review.verdict === "approve") {
      writeFileSync("output.md", `# ${task}\n\n_score: ${review.score}/10_\n\n${plan}\n`);
      console.log(`\n✅ План одобрен (score ${review.score}/10), сохранён в output.md`);
      return;
    }
    issues = review.issues; // revise → следующий раунд
  }

  console.log("\n⚠️ 3 раунда пройдено, план так и не одобрен. Ничего не сохранено.");
}

main().catch((err) => {
  console.error("Ошибка:", err instanceof Error ? err.message : err);
  process.exit(1);
});
