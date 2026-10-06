import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";

import { createHealthCoach } from "../agents/healthCoach";
import { createSafetyReviewer } from "../agents/safetyReviewer";
import { ACTIVE_PROMPTS, loadPrompt, type PromptVersions } from "./promptVersions";
import { createRoundsLog, type RoundState } from "./rounds";
import { finalScore, improved } from "./score";
import { requestReview, type Review } from "./validateReview";

// ─────────────────────────────────────────────────────────────────────────────
// ОРКЕСТРАТОР
//
// Собирает прогон из модулей харнесса: берёт версии промптов, строит агентов,
// крутит цикл коуч ↔ ревьюер и складывает трейс. Вся проверка ответа ревьюера
// живёт в validateReview, история раундов — в rounds, выводы по оценкам — в
// score. Здесь остаются только связывание, развилка по вердикту и запись файла.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ПРОВАЙДЕР: OpenRouter через OpenAI-совместимый API
//
// Agents SDK не умеет ходить в OpenRouter напрямую — он умеет ходить в «клиент
// OpenAI SDK». Поэтому подменяем сам клиент: создаём обычный OpenAI-клиент, но
// с чужим baseURL и чужим ключом. Для SDK это по-прежнему «OpenAI», по факту —
// OpenRouter, который проксирует запрос в DeepSeek.
//
// Настройка ленивая (один раз на процесс, при первом прогоне): в CLI она
// происходила на старте, но в Next.js модуль грузится при импорте роута, и
// падение на отсутствующем ключе превратилось бы в 500 без внятного текста.
// ─────────────────────────────────────────────────────────────────────────────
let providerReady = false;

function ensureProvider() {
  if (providerReady) return;

  if (!process.env.OPENROUTER_API_KEY) {
    // openai-пакет бросает исключение прямо в конструкторе, если ключа нет —
    // проверяем заранее, чтобы вместо стектрейса показать понятную подсказку.
    throw new Error("Не задан OPENROUTER_API_KEY в .env (см. .env.example)");
  }

  // new OpenAI({...}) — HTTP-клиент официального openai-пакета. Он не делает
  // запросов при создании, только хранит настройки: куда стучаться (baseURL),
  // чем авторизоваться (apiKey), таймауты и ретраи. Все вызовы вида
  // client.chat.completions.create(...) уйдут на baseURL + "/chat/completions".
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

  providerReady = true;
}

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

// Контекст и результат лежат в data/, пути считаем от корня проекта —
// и dev-сервер, и production-сборка запускаются оттуда.
const dataPath = (file: string) => join(process.cwd(), "data", file);

const DEFAULT_MAX_ROUNDS = 3;

export type HealthAgentResult = {
  /** Финальный план. null — если вердикт needs_human_professional: план не отдаём. */
  plan: string | null;
  /** Ревью последнего раунда — по нему принято решение. */
  review: Review;
  /** Трейс прогона: каждый раунд с планом и его ревью. */
  rounds: RoundState[];
  /** Score последнего одобренного раунда; null, если approve не случился. */
  finalScore: number | null;
  /** Вырос ли score на последней ревизии относительно предыдущего раунда. */
  improved: boolean;
  /** Версии промптов, которыми фактически отработал прогон. */
  promptVersions: PromptVersions;
  /** Длительность прогона целиком, включая чтение файлов и запись output.md. */
  durationMs: number;
};

export async function runHealthAgent(
  task: string,
  maxRounds: number = DEFAULT_MAX_ROUNDS,
): Promise<HealthAgentResult> {
  const startedAt = Date.now();
  ensureProvider();

  // Версии промптов фиксируем один раз на прогон: даже если ACTIVE_PROMPTS
  // поменяют между раундами, трейс останется честным.
  const promptVersions: PromptVersions = {
    coach: ACTIVE_PROMPTS.coach,
    reviewer: ACTIVE_PROMPTS.reviewer,
  };
  const coach = createHealthCoach(loadPrompt("healthCoach", promptVersions.coach));
  const reviewer = createSafetyReviewer(loadPrompt("safetyReviewer", promptVersions.reviewer));

  // Контекст из markdown-файлов
  const profile = readFileSync(dataPath("profile.md"), "utf8");
  const diary = readFileSync(dataPath("log.md"), "utf8");
  const context = `# ПРОФИЛЬ\n${profile}\n\n# ДНЕВНИК\n${diary}\n\n# ЗАДАЧА\n${task}`;

  const roundsLog = createRoundsLog();

  const finish = (plan: string | null, review: Review): HealthAgentResult => {
    const rounds = roundsLog.all();
    return {
      plan,
      review,
      rounds,
      finalScore: finalScore(rounds),
      improved: improved(rounds),
      promptVersions,
      durationMs: Date.now() - startedAt,
    };
  };

  let plan = "";
  let issues: string[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    // Коуч генерирует план (со второго раунда — с учётом замечаний ревьюера)
    const coachInput = issues.length
      ? `${context}\n\n# ПРЕДЫДУЩИЙ ПЛАН\n${plan}\n\n# ЗАМЕЧАНИЯ РЕВЬЮЕРА (исправь их и верни план целиком)\n- ${issues.join("\n- ")}`
      : context;
    plan = await ask(coach, coachInput);

    // Ревьюер проверяет план; разбор ответа и один ретрай — в validateReview.
    // Каждый run() — независимый вызов без общей памяти между агентами, поэтому
    // план передаём ревьюеру текстом внутри input.
    const reviewInput = `# ПРОФИЛЬ\n${profile}\n\n# ДНЕВНИК\n${diary}\n\n# ЗАПРОС ПОЛЬЗОВАТЕЛЯ\n${task}\n\n# ПЛАН НА ПРОВЕРКУ\n${plan}`;
    const review = await requestReview((input) => ask(reviewer, input), reviewInput);
    roundsLog.record(plan, review);

    console.log(
      `\n[Раунд ${round}] verdict=${review.verdict} score=${review.score}` +
        (review.issues.length ? `\nissues:\n- ${review.issues.join("\n- ")}` : "\nissues: нет"),
    );

    // Развилка по вердикту
    if (review.verdict === "needs_human_professional") {
      console.log("\n⛔ Запрос требует живого специалиста (врача). План не сохранён.");
      if (review.issues.length) console.log(`Причины:\n- ${review.issues.join("\n- ")}`);
      return finish(null, review);
    }
    if (review.verdict === "approve") {
      writeFileSync(dataPath("output.md"), `# ${task}\n\n_score: ${review.score}/10_\n\n${plan}\n`);
      console.log(`\n✅ План одобрен (score ${review.score}/10), сохранён в data/output.md`);
      return finish(plan, review);
    }
    issues = review.issues; // revise → следующий раунд
  }

  const last = roundsLog.last();
  if (!last) throw new Error(`maxRounds = ${maxRounds}: прогон не сделал ни одного раунда`);

  console.log(`\n⚠️ ${maxRounds} раунда пройдено, план так и не одобрен. Ничего не сохранено.`);
  return finish(last.plan, last.review);
}
