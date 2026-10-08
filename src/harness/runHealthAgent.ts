import "dotenv/config";
import OpenAI from "openai";
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";

import { COACH_MODEL, createHealthCoach } from "../agents/healthCoach";
import { createSafetyReviewer, REVIEWER_MODEL } from "../agents/safetyReviewer";
import { PLANNING_TOOLS, SAVING_TOOLS } from "../skills";
import { getProfile } from "../skills/profile";
import { getRecentLog } from "../skills/logs";
import { ACTIVE_PROMPTS, loadPrompt, type PromptVersions } from "./promptVersions";
import { createRoundsLog, type RoundState } from "./rounds";
import { finalScore, improved } from "./score";
import { collectToolCalls } from "./toolCalls";
import { traceRun } from "./traceRun";
import { requestReview, type Review } from "./validateReview";

// ─────────────────────────────────────────────────────────────────────────────
// ОРКЕСТРАТОР
//
// Собирает прогон из модулей харнесса: берёт версии промптов, строит агентов,
// крутит цикл коуч ↔ ревьюер и складывает трейс. Вся проверка ответа ревьюера
// живёт в validateReview, история раундов — в rounds, выводы по оценкам — в
// score, трейс вызовов инструментов — в toolCalls. Здесь остаются только
// связывание, развилка по вердикту и выбор того, какие tools открыты на какой
// фазе прогона.
//
// Контекст коуча в промпт больше не вклеивается: профиль и дневник он достаёт
// сам через скиллы (src/skills/), когда решит, что они ему нужны.
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
  // формате Chat Completions (/chat/completions): messages[], role/content,
  // tools[] с JSON-схемами параметров — то, что понимает почти любой
  // OpenAI-совместимый провайдер.
  setOpenAIAPI("chat_completions");

  // setTracingDisabled(true) — выключает встроенный экспорт трейсов. По умолчанию
  // SDK шлёт телеметрию прогонов на платформу OpenAI, а для этого нужен ключ
  // OpenAI, которого у нас нет: без выключения в консоль сыпались бы 401.
  setTracingDisabled(true);

  providerReady = true;
}

/** Ответ агента: финальный текст и имена инструментов, которые он вызвал по пути. */
type AgentReply = { text: string; toolCalls: string[] };

// run(agent, input) — запускает агентный цикл: собирает запрос (system из
// instructions + наш input как сообщение user), шлёт его через клиент, получает
// ответ. Если модель вместо текста просит вызвать инструмент, SDK сам исполняет
// его execute, кладёт результат в историю и идёт к модели снова — и так по
// кругу, пока не придёт финальный текст (не больше maxTurns, по умолчанию 10).
// Именно поэтому у коуча с tools один run() может стоить несколько обращений к
// модели, а у ревьюера без tools — всегда ровно одно.
// Возвращает RunResult; нужные поля — finalOutput (текст последнего ответа) и
// newItems (всё, что произошло за прогон: сообщения, вызовы инструментов и их
// результаты) — из них собирается трейс вызовов.
async function ask(agent: Agent, input: string): Promise<AgentReply> {
  const result = await run(agent, input);
  return {
    text: String(result.finalOutput ?? ""),
    toolCalls: collectToolCalls(result.newItems),
  };
}

const DEFAULT_MAX_ROUNDS = 3;

/** Сколько последних записей дневника видит ревьюер. Коуч решает это сам, через getRecentLog. */
const REVIEWER_LOG_DAYS = 7;

export type HealthAgentResult = {
  /** Финальный план. null — если вердикт needs_human_professional: план не отдаём. */
  plan: string | null;
  /** Ревью последнего раунда — по нему принято решение. */
  review: Review;
  /** Трейс прогона: каждый раунд с планом и его ревью. */
  rounds: RoundState[];
  /** Имена инструментов, вызванных коучем за весь прогон, по порядку. */
  toolCalls: string[];
  /** Score последнего одобренного раунда; null, если approve не случился. */
  finalScore: number | null;
  /** Вырос ли score на последней ревизии относительно предыдущего раунда. */
  improved: boolean;
  /** Версии промптов, которыми фактически отработал прогон. */
  promptVersions: PromptVersions;
  /** Длительность прогона целиком, включая вызовы инструментов. */
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
  const coachPrompt = loadPrompt("healthCoach", promptVersions.coach);

  // Коуч фазы генерации: инструменты чтения и подготовки, но без savePlan —
  // одобренного плана на этой фазе ещё не существует.
  const coach = createHealthCoach(coachPrompt, { tools: PLANNING_TOOLS });
  const reviewer = createSafetyReviewer(loadPrompt("safetyReviewer", promptVersions.reviewer));

  // Ревьюеру контекст по-прежнему приходит текстом: у него нет и не должно быть
  // инструментов (см. agents/safetyReviewer.ts). Скиллы здесь зовутся как
  // обычные функции — модель в этом не участвует, лишних вызовов не возникает.
  const reviewerContext = `# ПРОФИЛЬ\n${getProfile()}\n\n# ДНЕВНИК\n${getRecentLog(REVIEWER_LOG_DAYS)}`;

  const roundsLog = createRoundsLog();
  const toolCalls: string[] = [];

  // Единственная точка выхода из прогона: через неё проходят все три развилки по
  // вердикту, поэтому трейс пишется здесь — и ни один исход не остаётся без файла.
  const finish = (plan: string | null, review: Review): HealthAgentResult => {
    const rounds = roundsLog.all();
    const result: HealthAgentResult = {
      plan,
      review,
      rounds,
      toolCalls,
      finalScore: finalScore(rounds),
      improved: improved(rounds),
      promptVersions,
      durationMs: Date.now() - startedAt,
    };

    const tracePath = traceRun({
      task,
      promptVersions,
      model: { coach: COACH_MODEL, reviewer: REVIEWER_MODEL },
      rounds,
      toolCalls,
      finalScore: result.finalScore,
      verdict: review.verdict,
      durationMs: result.durationMs,
    });
    if (tracePath) console.log(`\nТрейс: ${tracePath}`);

    return result;
  };

  let plan = "";
  let issues: string[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    // Коуч получает только задачу: профиль, дневник и рецепты он добирает сам,
    // вызывая скиллы. Со второго раунда к задаче добавляются прошлый план и
    // замечания ревьюера.
    const coachInput = issues.length
      ? `# ЗАДАЧА\n${task}\n\n# ПРЕДЫДУЩИЙ ПЛАН\n${plan}\n\n# ЗАМЕЧАНИЯ РЕВЬЮЕРА (исправь их и верни план целиком)\n- ${issues.join("\n- ")}`
      : `# ЗАДАЧА\n${task}`;
    const coachReply = await ask(coach, coachInput);
    plan = coachReply.text;
    toolCalls.push(...coachReply.toolCalls);

    // Ревьюер проверяет план; разбор ответа и один ретрай — в validateReview.
    // Каждый run() — независимый вызов без общей памяти между агентами, поэтому
    // план передаём ревьюеру текстом внутри input.
    const reviewInput = `${reviewerContext}\n\n# ЗАПРОС ПОЛЬЗОВАТЕЛЯ\n${task}\n\n# ПЛАН НА ПРОВЕРКУ\n${plan}`;
    const review = await requestReview(
      async (input) => (await ask(reviewer, input)).text,
      reviewInput,
    );
    roundsLog.record(plan, review);

    console.log(
      `\n[Раунд ${round}] verdict=${review.verdict} score=${review.score}` +
        `\ntools: ${coachReply.toolCalls.join(", ") || "нет"}` +
        (review.issues.length ? `\nissues:\n- ${review.issues.join("\n- ")}` : "\nissues: нет"),
    );

    // Развилка по вердикту
    if (review.verdict === "needs_human_professional") {
      console.log("\n⛔ Запрос требует живого специалиста (врача). План не сохранён.");
      if (review.issues.length) console.log(`Причины:\n- ${review.issues.join("\n- ")}`);
      return finish(null, review);
    }
    if (review.verdict === "approve") {
      toolCalls.push(...(await savePhase(coachPrompt, task, plan, review.score)));
      return finish(plan, review);
    }
    issues = review.issues; // revise → следующий раунд
  }

  const last = roundsLog.last();
  if (!last) throw new Error(`maxRounds = ${maxRounds}: прогон не сделал ни одного раунда`);

  console.log(`\n⚠️ ${maxRounds} раунда пройдено, план так и не одобрен. Ничего не сохранено.`);
  return finish(last.plan, last.review);
}

// ─────────────────────────────────────────────────────────────────────────────
// ФАЗА СОХРАНЕНИЯ
//
// Отдельный агент на той же модели и том же промпте, но с другим набором tools:
// только savePlan, и toolChoice="required", потому что от него ждут не текста, а
// одного вызова. Это и есть гейт: право записи выдаёт харнесс сменой
// конфигурации агента, а не инструкция в промпте (почему именно так —
// подробно в skills/plans.ts).
//
// Текст плана передаётся дословно между маркерами: модель здесь ничего не
// сочиняет, её работа — донести готовый план до инструмента. Прогон обрывается
// на первом же вызове (stopOnFirstTool): записывать файл второй раз незачем,
// и возвращаться к модели после записи тоже.
//
// Ошибка этой фазы не роняет прогон: план уже одобрен и уйдёт пользователю в
// ответе API. Не записанный файл — потеря, но меньшая, чем 500 вместо готового
// плана.
// ─────────────────────────────────────────────────────────────────────────────
async function savePhase(
  coachPrompt: string,
  task: string,
  plan: string,
  score: number,
): Promise<string[]> {
  const document = `# ${task}\n\n_score: ${score}/10_\n\n${plan}`;
  const input =
    `Safety Reviewer одобрил план (score ${score}/10). Сохрани его.\n\n` +
    `Вызови savePlan и передай в параметре markdown ровно текст между маркерами, ` +
    `дословно и целиком, ничего не добавляя и не сокращая.\n\n` +
    `<<<PLAN\n${document}\nPLAN>>>`;

  const saver = createHealthCoach(coachPrompt, {
    tools: SAVING_TOOLS,
    toolChoice: "required",
    stopOnFirstTool: true,
  });

  try {
    const reply = await ask(saver, input);
    if (reply.toolCalls.includes("savePlan")) {
      console.log(`\n✅ План одобрен (score ${score}/10), сохранён в data/output.md`);
    } else {
      console.log("\n⚠️ План одобрен, но агент не вызвал savePlan — файл не обновлён.");
    }
    return reply.toolCalls;
  } catch (err) {
    console.log(`\n⚠️ Фаза сохранения не удалась: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}
