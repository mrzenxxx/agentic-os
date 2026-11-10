import type { ChatMessage, ChatRunSummary } from "@/src/chat/types";
import type { RunEvent, RunStage } from "@/src/harness/events";
import { ChatIcon } from "./icons";
import styles from "./chat.module.css";

export const stageLabels: Record<RunStage, string> = {
  reading_profile: "Reading profile",
  searching_knowledge: "Searching knowledge",
  generating_plan: "Generating plan",
  reviewing_safety: "Reviewing safety",
  revising: "Revising",
  final_approved_plan: "Final approved plan",
};

const toolLabels: Record<string, string> = {
  read_profile: "Прочитал профиль",
  read_recent_logs: "Прочитал дневник",
  list_recipes: "Посмотрел любимые рецепты",
  searchKnowledge: "База знаний",
  suggestWorkoutTemplate: "Подобрал тренировку",
  generateShoppingList: "Составил список покупок",
  save_health_plan: "Сохранил план",
};

export function messageEvents(message: ChatMessage): RunEvent[] {
  return message.parts.flatMap((part) => part.type === "data-event" ? [part.data] : []);
}

export function messageResult(message: ChatMessage): ChatRunSummary | undefined {
  return message.parts.find((part) => part.type === "data-result")?.data;
}

function TimelineRow({ event, interrupted }: { event: RunEvent; interrupted: boolean }) {
  const status = interrupted && event.status === "running" ? "error" : event.status;
  const label = event.type === "stage"
    ? `${stageLabels[event.stage]}${event.stage === "revising" ? ` (round ${event.round})` : ""}`
    : toolLabels[event.name] ?? event.name;

  return (
    <li className={`${styles.timelineRow} ${event.type === "tool" ? styles.toolRow : ""}`} data-status={status}>
      <span className={styles.timelineMarker}>
        {status === "running" ? <span className={styles.spinner} /> : status === "error" ? <ChatIcon name="warning" /> : event.type === "tool" ? <ChatIcon name={event.source} /> : <ChatIcon name="check" />}
      </span>
      <div className={styles.stepContent}>
        <div className={styles.stepHeading}>
          <span>{label}</span>
          {event.type === "tool" && <span className={styles.source} title={event.server ?? (event.source === "rag" ? "Supabase" : "Локальный инструмент")}>[{event.source}]</span>}
          {event.type === "stage" && event.verdict && <span className={styles.reviewScore}>{event.verdict} · {event.score}/10</span>}
          {event.type === "stage" && event.chunkCount !== undefined && <span className={styles.stepDetail}>{event.chunkCount} chunks</span>}
          <span className={styles.srOnly}>{status === "running" ? "Выполняется" : status === "error" ? "Не завершено" : "Завершено"}</span>
        </div>
        {event.type === "stage" && event.query && <p className={styles.query}>{event.query}</p>}
        {event.type === "tool" && <code className={styles.toolName}>{event.name}{event.server ? ` · ${event.server}` : ""}</code>}
      </div>
    </li>
  );
}

function RunSummary({ result }: { result: ChatRunSummary }) {
  return (
    <footer className={styles.runSummary}>
      <div className={styles.verdict} data-verdict={result.review.verdict}>
        <ChatIcon name={result.review.verdict === "approve" ? "check" : "warning"} />
        <strong>{result.review.verdict}</strong>
        <span>{result.finalScore ?? result.review.score}/10</span>
      </div>
      <details className={styles.runDetails}>
        <summary>Детали запуска</summary>
        <p>Раундов: {result.roundCount} · {Math.round(result.durationMs / 1000)} с · coach {result.promptVersions.coach} / reviewer {result.promptVersions.reviewer}</p>
        {result.saveSummary && <p>{result.saveSummary}</p>}
        {result.review.verdict === "approve" && result.review.issues.length > 0 && <ul>{result.review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
      </details>
    </footer>
  );
}

export function ChatMessageView({ message, active, failed }: { message: ChatMessage; active: boolean; failed: boolean }) {
  const text = message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
  if (message.role === "user") return (
    <article className={styles.userMessage} aria-label="Ваше сообщение"><p>{text}</p></article>
  );

  const events = messageEvents(message);
  const result = messageResult(message);
  const specialist = result?.review.verdict === "needs_human_professional";
  const unapproved = result?.review.verdict === "revise";
  return (
    <article className={styles.assistantMessage} aria-label="Ответ коуча" aria-busy={active}>
      <div className={styles.assistantLabel}><ChatIcon name="coach" /><span>Health Coach</span></div>
      {events.length > 0 && <ol className={styles.timeline} aria-label="Этапы запуска">{events.map((event) => <TimelineRow key={event.id} event={event} interrupted={failed || (!active && !result)} />)}</ol>}
      {(specialist || unapproved) ? (
        <section className={styles.safetyCard} aria-label={specialist ? "Требуется специалист" : "План требует доработки"}>
          <ChatIcon name="warning" />
          <div><h2>{specialist ? "Требуется специалист" : "План требует доработки"}</h2>
            <p>{specialist ? "Этот запрос требует участия специалиста. План не выдан." : "После трёх раундов план не прошёл проверку безопасности. Уточните задачу."}</p>
            <ul>{result.review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
          </div>
        </section>
      ) : text ? <div className={styles.plan}>{text}{active && <span className={styles.cursor} aria-hidden="true" />}</div> : active && events.length === 0 ? <p className={styles.pending}>Подключаю инструменты…</p> : null}
      {result && <RunSummary result={result} />}
    </article>
  );
}
