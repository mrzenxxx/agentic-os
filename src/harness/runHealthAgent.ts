import "dotenv/config";
import OpenAI from "openai";
import {
  Agent,
  RunResult,
  RunState,
  RunContext,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
  type MCPServerStdio,
} from "@openai/agents";

import { COACH_MODEL, createHealthCoach } from "../agents/healthCoach";
import { createSafetyReviewer, REVIEWER_MODEL } from "../agents/safetyReviewer";
import { PLANNING_TOOLS } from "../skills";
import { SAVING_AGENT_NAME, EXPORT_AGENT_NAME } from "../mcp/healthMcp";
import { createMcpServers, connectMcpServers, closeMcpServers } from "../mcp/serverRegistry";
import { readReviewerContext } from "../mcp/reviewerContext";
import { ACTIVE_PROMPTS, loadPrompt, type PromptVersions } from "./promptVersions";
import { createRoundsLog, type RoundState } from "./rounds";
import { finalScore, improved } from "./score";
import { collectToolCalls } from "./toolCalls";
import { collectRetrievals } from "./retrievals";
import type { RetrievalTrace } from "../rag/types";
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
// сам через MCP tools, когда решит, что они ему нужны.
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
type AgentReply = { text: string; toolCalls: string[]; retrievals?: RetrievalTrace[] };

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
    retrievals: collectRetrievals(result.newItems),
  };
}

const DEFAULT_MAX_ROUNDS = 3;

export type HealthAgentResult = {
  /** Финальный план. null — если вердикт needs_human_professional: план не отдаём. */
  plan: string | null;
  /** Ревью последнего раунда — по нему принято решение. */
  review: Review;
  /** Трейс прогона: каждый раунд с планом и его ревью. */
  rounds: RoundState[];
  /** Имена инструментов, вызванных коучем за весь прогон, по порядку. */
  toolCalls: string[];
  /** Запросы RAG и реально найденные источники, без копирования chunks в трейс. */
  retrievals: RetrievalTrace[];
  /** Результат записи и явно запрошенных экспортов, отдельно от проверенного плана. */
  saveSummary: string | null;
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

  // Соединение не глобальное: отдельный stdio-процесс живёт ровно один прогон.
  // finally срабатывает и при ошибке connect, модели или разбора ревью.
  const servers = createMcpServers();
  try {
    await connectMcpServers(servers);
    return await runWithMcp(task, maxRounds, servers, startedAt);
  } finally {
    await closeMcpServers(servers);
  }
}

async function runWithMcp(
  task: string,
  maxRounds: number,
  servers: MCPServerStdio[],
  startedAt: number,
): Promise<HealthAgentResult> {

  // Версии промптов фиксируем один раз на прогон: даже если ACTIVE_PROMPTS
  // поменяют между раундами, трейс останется честным.
  const promptVersions: PromptVersions = {
    coach: ACTIVE_PROMPTS.coach,
    reviewer: ACTIVE_PROMPTS.reviewer,
  };
  const runTimeContext = `Среда выполнения: начало запуска ${new Date(startedAt).toISOString()} (UTC).`;
  const coachPrompt = loadPrompt("healthCoach", promptVersions.coach) +
    `\n\n${runTimeContext} ` +
    `Корень проекта: ${process.cwd()}. ` +
    `Подключённые MCP-серверы: ${servers.map((server) => server.name).join(", ") || "нет"}. ` +
    `Не используй отключённые инструменты и не утверждай, что они были вызваны.`;

  // Коуч фазы генерации: MCP + локальные инструменты, но без save_health_plan —
  // одобренного плана на этой фазе ещё не существует.
  const coach = createHealthCoach(coachPrompt, { tools: PLANNING_TOOLS, mcpServers: servers });
  const reviewer = createSafetyReviewer(
    `${loadPrompt("safetyReviewer", promptVersions.reviewer)}\n\n${runTimeContext}`,
  );

  // Ревьюеру контекст по-прежнему приходит текстом: у него нет и не должно быть
  // инструментов (см. agents/safetyReviewer.ts). Harness читает MCP resources
  // напрямую: модель в этом не участвует, поэтому это не agent toolCalls.
  const reviewerContext = await readReviewerContext(servers);

  const roundsLog = createRoundsLog();
  const toolCalls: string[] = [];
  const retrievals: RetrievalTrace[] = [];
  let saveSummary: string | null = null;

  // Единственная точка выхода из прогона: через неё проходят все три развилки по
  // вердикту, поэтому трейс пишется здесь — и ни один исход не остаётся без файла.
  const finish = (plan: string | null, review: Review): HealthAgentResult => {
    const rounds = roundsLog.all();
    const result: HealthAgentResult = {
      plan,
      review,
      rounds,
      toolCalls,
      retrievals,
      saveSummary,
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
      retrievals,
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
    // вызывая MCP tools. Со второго раунда к задаче добавляются прошлый план и
    // замечания ревьюера.
    const coachInput = issues.length
      ? `# ЗАДАЧА\n${task}\n\n# ПРЕДЫДУЩИЙ ПЛАН\n${plan}\n\n# ЗАМЕЧАНИЯ РЕВЬЮЕРА (исправь их и верни план целиком)\n- ${issues.join("\n- ")}`
      : `# ЗАДАЧА\n${task}`;
    const coachReply = await ask(coach, coachInput);
    plan = coachReply.text;
    retrievals.push(...(coachReply.retrievals ?? []).map((retrieval) => ({
      ...retrieval, toolCallIndex: retrieval.toolCallIndex + toolCalls.length,
    })));
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
      const saved = await savePhase(servers, coachPrompt, task, plan, review.score);
      toolCalls.push(...saved.toolCalls);
      saveSummary = saved.text;
      return finish(plan, review);
    }
    issues = review.issues; // revise → следующий раунд
  }

  const last = roundsLog.last();
  if (!last) throw new Error(`maxRounds = ${maxRounds}: прогон не сделал ни одного раунда`);

  console.log(`\n⚠️ ${maxRounds} раунда пройдено, план так и не одобрен. Ничего не сохранено.`);
  return finish(last.plan, last.review);
}

// После approve основной план записывается обязательным единственным tool call.
// Затем exporter получает внешние tools записи для явно запрошенных копий.
// Ошибка одной записи не отменяет одобренный план и не скрывает предыдущие вызовы.
async function savePhase(
  servers: MCPServerStdio[],
  coachPrompt: string,
  task: string,
  plan: string,
  score: number,
): Promise<AgentReply> {
  const document = `# ${task}\n\n_score: ${score}/10_\n\n${plan}`;
  const calls: string[] = [];
  const summaries: string[] = [];
  const health = servers.find((server) => server.name === "markdown-health");

  const execute = async (agent: Agent, input: string): Promise<AgentReply | null> => {
    // Держим состояние сами: обычная сетевая ошибка OpenAI API не обязана
    // содержать error.state, хотя предыдущая запись уже могла выполниться.
    const state = new RunState(new RunContext(), input, agent, 10);
    try {
      const result = await run(agent, state);
      const reply = { text: String(result.finalOutput ?? ""), toolCalls: collectToolCalls(result.newItems) };
      calls.push(...reply.toolCalls);
      return reply;
    } catch (error) {
      // SDK сохраняет уже выполненные вызовы в состоянии даже при ошибке.
      calls.push(...collectToolCalls(new RunResult<unknown, Agent<unknown, any>>(state).newItems));
      const message = `Сохранение не завершено: ${error instanceof Error ? error.message : error}`;
      summaries.push(message);
      console.warn(message);
      return null;
    }
  };

  if (health) {
    const saver = createHealthCoach(coachPrompt, {
      name: SAVING_AGENT_NAME,
      mcpServers: [health],
      toolChoice: "required",
      stopOnFirstTool: true,
    });
    const saved = await execute(saver,
      `ФАЗА СОХРАНЕНИЯ. Safety Reviewer одобрил план (score ${score}/10). ` +
      `Один раз вызови save_health_plan и передай в markdown ровно текст между маркерами, ` +
      `дословно и целиком.\n\n<<<PLAN\n${document}\nPLAN>>>`);
    if (saved?.toolCalls.includes("[markdown-health] save_health_plan")) {
      summaries.push("План сохранён в data/output.md.");
    } else if (saved) {
      summaries.push("Основной план не сохранён: агент не вызвал save_health_plan.");
    }
  } else {
    summaries.push("Основное сохранение недоступно: markdown-health отключён.");
  }

  const exporter = createHealthCoach(coachPrompt, {
    name: EXPORT_AGENT_NAME,
    mcpServers: servers,
  });
  const exported = await execute(exporter,
    `ФАЗА СОХРАНЕНИЯ — ДОПОЛНИТЕЛЬНЫЕ КОПИИ. Safety Reviewer одобрил план. ` +
    `Основное сохранение уже обработано, не повторяй его. ` +
    `Выполни только дополнительные записи, явно запрошенные в исходном запросе. ` +
    `Если дополнительных назначений не было, ответь «Дополнительные копии не запрошены» ` +
    `без вызовов инструментов. Недоступные назначения отметь в отчёте.\n\n` +
    `Исходный запрос: ${task}\n\n` +
    `Сохраняй дословно весь текст между маркерами. Для Notion можно разбить его ` +
    `на блоки без потери содержимого. Не переписывай план. ` +
    `Заверши кратким отчётом: реальные пути/URL успешных записей и ошибки. ` +
    `Успех утверждай только по успешному ответу инструмента.\n\n` +
    `<<<PLAN\n${document}\nPLAN>>>`);
  if (exported?.text) summaries.push(exported.text);
  return { toolCalls: calls, text: summaries.join("\n") };
}
