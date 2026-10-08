import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runHealthAgent } from "../src/harness/runHealthAgent";
import type { Review } from "../src/harness/validateReview";

/**
 * Мини-evals: прогоняет кейсы из `evals/cases/*.json` и печатает таблицу PASS/FAIL.
 *
 *   npm run eval
 *
 * Это не фреймворк и не должен им стать: один скрипт, последовательный цикл,
 * никаких раннеров и параллельности. Прогоны идут по очереди сознательно —
 * они пишут в общие файлы (`data/output.md`, `runs/`), и параллельный запуск
 * перемешал бы результаты.
 *
 * Каждый кейс — полный прогон через модель, поэтому пять кейсов занимают
 * ~10 минут и стоят денег. Запускать стоит после правки промптов, скиллов или
 * моделей, а не на каждое изменение вёрстки.
 */

type EvalCase = {
  name: string;
  task: string;
  expect: {
    verdict: Review["verdict"];
    /** Нижняя граница оценки. Проверяется только когда задана. */
    minScore?: number;
  };
};

type EvalOutcome = {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  score: number | null;
  rounds: number;
  toolCalls: number;
  /** Почему кейс не прошёл; пусто у прошедших. */
  reason: string;
};

const casesDir = join(process.cwd(), "evals", "cases");

function loadCases(): EvalCase[] {
  const files = readdirSync(casesDir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  return files.map((file) => {
    const raw = readFileSync(join(casesDir, file), "utf8");
    const parsed = JSON.parse(raw) as EvalCase;
    if (!parsed.name || !parsed.task || !parsed.expect?.verdict) {
      throw new Error(`Кейс ${file} неполный: нужны name, task и expect.verdict`);
    }
    return parsed;
  });
}

async function runCase(testCase: EvalCase): Promise<EvalOutcome> {
  const result = await runHealthAgent(testCase.task);
  const verdict = result.review.verdict;
  // finalScore есть только у одобренных прогонов; у остальных берём оценку того
  // ревью, по которому принято решение.
  const score = result.finalScore ?? result.review.score;

  const expectedScore = testCase.expect.minScore;
  const verdictOk = verdict === testCase.expect.verdict;
  const scoreOk = expectedScore === undefined || score >= expectedScore;

  const reasons = [
    verdictOk ? "" : `вердикт ${verdict}, ожидался ${testCase.expect.verdict}`,
    scoreOk ? "" : `score ${score} ниже минимума ${expectedScore}`,
  ].filter(Boolean);

  return {
    name: testCase.name,
    passed: verdictOk && scoreOk,
    expected:
      testCase.expect.verdict + (expectedScore === undefined ? "" : ` ≥${expectedScore}`),
    actual: verdict,
    score,
    rounds: result.rounds.length,
    toolCalls: result.toolCalls.length,
    reason: reasons.join("; "),
  };
}

function printTable(outcomes: EvalOutcome[]) {
  const widths = {
    name: Math.max(6, ...outcomes.map((o) => o.name.length)),
    expected: Math.max(8, ...outcomes.map((o) => o.expected.length)),
    actual: Math.max(6, ...outcomes.map((o) => o.actual.length)),
  };

  const header =
    "      " +
    "кейс".padEnd(widths.name + 2) +
    "ожидали".padEnd(widths.expected + 2) +
    "получили".padEnd(widths.actual + 2) +
    "score  раундов  tools";
  console.log(`\n${header}`);
  console.log("─".repeat(header.length));

  for (const outcome of outcomes) {
    console.log(
      `${outcome.passed ? "PASS  " : "FAIL  "}` +
        outcome.name.padEnd(widths.name + 2) +
        outcome.expected.padEnd(widths.expected + 2) +
        outcome.actual.padEnd(widths.actual + 2) +
        `${String(outcome.score ?? "—").padEnd(7)}${String(outcome.rounds).padEnd(9)}${outcome.toolCalls}`,
    );
    if (!outcome.passed) console.log(`      └ ${outcome.reason}`);
  }
}

const cases = loadCases();
console.log(`Кейсов: ${cases.length}. Каждый — полный прогон, это займёт несколько минут.`);

const outcomes: EvalOutcome[] = [];
for (const [index, testCase] of cases.entries()) {
  console.log(`\n───── [${index + 1}/${cases.length}] ${testCase.name}`);
  try {
    outcomes.push(await runCase(testCase));
  } catch (err) {
    // Упавший прогон — это FAIL кейса, а не падение всего набора: остальные
    // кейсы ещё могут дать полезный сигнал.
    outcomes.push({
      name: testCase.name,
      passed: false,
      expected: testCase.expect.verdict,
      actual: "ошибка",
      score: null,
      rounds: 0,
      toolCalls: 0,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

printTable(outcomes);

const failed = outcomes.filter((outcome) => !outcome.passed).length;
console.log(`\nИтог: ${outcomes.length - failed}/${outcomes.length} PASS`);
process.exit(failed === 0 ? 0 : 1);
