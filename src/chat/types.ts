import type { UIMessage } from "ai";
import type { RunEvent } from "../harness/events";
import type { HealthAgentResult } from "../harness/runHealthAgent";

/** В чат не отправляются черновики rounds и альтернативные планы. */
export type ChatRunSummary = Pick<HealthAgentResult,
  "review" | "finalScore" | "promptVersions" | "durationMs" | "saveSummary"
> & { roundCount: number };

export type ChatMessage = UIMessage<unknown, {
  event: RunEvent;
  result: ChatRunSummary;
}>;
