import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { PromptVersions } from "./promptVersions";
import type { RoundState } from "./rounds";
import type { Review } from "./validateReview";

/**
 * Персистентный трейс прогона: один запуск — один JSON в `runs/`.
 *
 * Зачем файл, если прогон и так возвращает всё наверх: ответ API живёт ровно
 * до перезагрузки страницы. Чтобы сравнить «как было до правки промпта» и «как
 * стало», нужен артефакт, переживающий процесс. На нём же стоят replay и evals
 * (`scripts/replay.ts`, `scripts/eval.ts`).
 *
 * Модуль ничего не знает про оркестратор: он принимает плоский снимок прогона и
 * кладёт его на диск. Поэтому и запись, и формат можно менять, не трогая цикл.
 */

/** Сколько символов плана попадает в трейс. План целиком раздул бы файл без пользы. */
const PLAN_EXCERPT_CHARS = 500;

export type TraceRound = {
  round: number;
  /** Начало плана этого раунда: чтобы отличить прогоны глазами, не храня их целиком. */
  planExcerpt: string;
  review: Review;
};

export type RunTrace = {
  runId: string;
  task: string;
  promptVersions: PromptVersions;
  model: { coach: string; reviewer: string };
  rounds: TraceRound[];
  toolCalls: string[];
  finalScore: number | null;
  verdict: Review["verdict"];
  durationMs: number;
  createdAt: string;
};

/** Снимок прогона, из которого собирается трейс. Ровно то, что знает оркестратор. */
export type TraceInput = {
  task: string;
  promptVersions: PromptVersions;
  model: { coach: string; reviewer: string };
  rounds: RoundState[];
  toolCalls: string[];
  finalScore: number | null;
  verdict: Review["verdict"];
  durationMs: number;
};

export const runsDir = () => join(process.cwd(), "runs");

/** `2026-10-08T12:34:56.789Z` → `2026-10-08T12-34-56-789Z`: ISO без запрещённых в имени файла символов. */
function fileSafeStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function buildTrace(input: TraceInput, createdAt: Date = new Date()): RunTrace {
  return {
    runId: `run-${fileSafeStamp(createdAt)}`,
    task: input.task,
    promptVersions: input.promptVersions,
    model: input.model,
    rounds: input.rounds.map((state) => ({
      round: state.round,
      planExcerpt: state.plan.slice(0, PLAN_EXCERPT_CHARS),
      review: state.review,
    })),
    toolCalls: input.toolCalls,
    finalScore: input.finalScore,
    verdict: input.verdict,
    durationMs: input.durationMs,
    createdAt: createdAt.toISOString(),
  };
}

/**
 * Пишет трейс в `runs/<runId>.json` и возвращает путь; при ошибке — null.
 *
 * Ошибка записи не роняет прогон сознательно: план уже сгенерирован и одобрен,
 * и терять его из-за недоступного каталога — хуже, чем остаться без трейса.
 * Поэтому исключение здесь гасится и превращается в предупреждение в логе.
 */
export function traceRun(input: TraceInput): string | null {
  try {
    const trace = buildTrace(input);
    const dir = runsDir();
    mkdirSync(dir, { recursive: true });

    const path = join(dir, `${trace.runId}.json`);
    writeFileSync(path, `${JSON.stringify(trace, null, 2)}\n`);
    return path;
  } catch (err) {
    console.log(`⚠️ Трейс не записан: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
