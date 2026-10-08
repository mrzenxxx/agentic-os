import { readFileSync } from "node:fs";

import { COACH_MODEL } from "../src/agents/healthCoach";
import { REVIEWER_MODEL } from "../src/agents/safetyReviewer";
import { runHealthAgent, type HealthAgentResult } from "../src/harness/runHealthAgent";
import type { RunTrace } from "../src/harness/traceRun";

/**
 * Replay: берёт задачу из сохранённого трейса и прогоняет её текущим кодом.
 *
 *   npm run replay runs/run-2026-10-08T12-34-56-789Z.json
 *
 * Смысл — увидеть, что изменила правка промпта, модели или скиллов: тот же вход,
 * два исхода рядом. Воспроизводится именно задача, а не ответ модели: прогон
 * недетерминирован, и расхождение в одну позицию score само по себе ни о чём не
 * говорит — смотреть надо на вердикт, число раундов и состав toolCalls.
 *
 * Новый прогон пишет собственный трейс в runs/ на общих основаниях — его потом
 * можно переиграть так же.
 */

function fail(message: string): never {
  console.error(`Ошибка: ${message}`);
  process.exit(1);
}

function loadTrace(path: string): RunTrace {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return fail(`не прочитать файл трейса: ${path}`);
  }

  try {
    const trace = JSON.parse(raw) as RunTrace;
    if (typeof trace.task !== "string" || !trace.task.trim()) {
      return fail(`в трейсе нет поля task: ${path}`);
    }
    return trace;
  } catch {
    return fail(`файл трейса не разбирается как JSON: ${path}`);
  }
}

const LABEL_WIDTH = 18;
/** Шире этого значения в колонку не влезают — такие строки печатаются в два яруса. */
const MAX_VALUE_WIDTH = 44;

type Row = { label: string; before: string; after: string };

/** Совпало — «·», разошлось — «→»: diff читается без вчитывания в значения. */
const mark = (row: Row) => (row.before === row.after ? "·" : "→");

/**
 * Печатает сравнение колонками, а длинные значения (списки toolCalls, id моделей) —
 * в два яруса: иначе колонки склеиваются и diff перестаёт читаться.
 */
function printRows(rows: Row[]) {
  const inline = rows.filter((r) => r.before.length <= MAX_VALUE_WIDTH && r.after.length <= MAX_VALUE_WIDTH);
  const valueWidth = Math.max(10, ...inline.map((r) => r.before.length)) + 2;

  console.log(`\n${"".padEnd(LABEL_WIDTH + 2)}${"было".padEnd(valueWidth)}стало`);
  console.log("─".repeat(LABEL_WIDTH + 2 + valueWidth + 24));

  for (const row of rows) {
    if (row.before.length <= MAX_VALUE_WIDTH && row.after.length <= MAX_VALUE_WIDTH) {
      console.log(`${mark(row)} ${row.label.padEnd(LABEL_WIDTH)}${row.before.padEnd(valueWidth)}${row.after}`);
      continue;
    }
    console.log(`${mark(row)} ${row.label}`);
    console.log(`    было:  ${row.before}`);
    console.log(`    стало: ${row.after}`);
  }
}

const versions = (v: { coach: string; reviewer: string }) => `coach ${v.coach} / reviewer ${v.reviewer}`;
const tools = (names: string[]) => (names.length ? names.join(", ") : "нет");
const seconds = (ms: number) => `${Math.round(ms / 1000)} с`;

function compare(trace: RunTrace, result: HealthAgentResult) {
  printRows([
    { label: "verdict", before: trace.verdict, after: result.review.verdict },
    { label: "score", before: String(trace.finalScore ?? "—"), after: String(result.finalScore ?? "—") },
    { label: "раундов", before: String(trace.rounds.length), after: String(result.rounds.length) },
    { label: "промпты", before: versions(trace.promptVersions), after: versions(result.promptVersions) },
    // Модель в результат прогона не попадает — берём ту же константу, которую
    // только что записал в новый трейс сам харнесс.
    { label: "модель коуча", before: trace.model.coach, after: COACH_MODEL },
    { label: "модель ревьюера", before: trace.model.reviewer, after: REVIEWER_MODEL },
    { label: "toolCalls", before: tools(trace.toolCalls), after: tools(result.toolCalls) },
    { label: "длительность", before: seconds(trace.durationMs), after: seconds(result.durationMs) },
  ]);
}

const path = process.argv[2];
if (!path) fail("не указан файл трейса. Пример: npm run replay runs/run-2026-01-01T00-00-00-000Z.json");

const trace = loadTrace(path);

console.log(`Replay трейса ${trace.runId}`);
console.log(`Задача: ${trace.task}`);
console.log(`Исходный прогон: ${trace.createdAt}\n`);

const result = await runHealthAgent(trace.task);
compare(trace, result);
