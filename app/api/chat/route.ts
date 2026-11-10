import { setTimeout as delay } from "node:timers/promises";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { readChatTask } from "@/src/chat/request";
import type { ChatMessage, ChatRunSummary } from "@/src/chat/types";
import { runHealthAgent } from "@/src/harness/runHealthAgent";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let task: string;
  try {
    const body = await request.text();
    if (body.length > 256_000) throw new Error("Сообщения слишком большие. Обновите страницу и сократите задачу.");
    task = readChatTask(JSON.parse(body));
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? "Некорректный JSON" : error instanceof Error ? error.message : "Задача не передана" }, { status: 400 });
  }

  const stream = createUIMessageStream<ChatMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: crypto.randomUUID() });
      const result = await runHealthAgent(task, undefined, (event) => {
        if (!request.signal.aborted) writer.write({ type: "data-event", id: event.id, data: event });
      });
      if (request.signal.aborted) return;

      // Safety Reviewer должен увидеть план целиком. Отдаём именно проверенный
      // текст, без второго вызова модели, который мог бы изменить одобренный план.
      if (result.review.verdict === "approve" && result.plan) {
        const id = "approved-plan";
        writer.write({ type: "text-start", id });
        for (const token of result.plan.match(/\s+|\S+/gu) ?? []) {
          if (request.signal.aborted) return;
          writer.write({ type: "text-delta", id, delta: token });
          await delay(8, undefined, { signal: request.signal });
        }
        writer.write({ type: "text-end", id });
      }

      const summary: ChatRunSummary = {
        review: result.review, finalScore: result.finalScore, promptVersions: result.promptVersions,
        durationMs: result.durationMs, saveSummary: result.saveSummary, roundCount: result.rounds.length,
      };
      writer.write({ type: "data-result", id: "run-result", data: summary });
      writer.write({ type: "finish", finishReason: "stop" });
      writer.setOutcome({ status: "completed" });
    },
    onError: (error) => {
      console.error("Ошибка чатового запуска:", error instanceof Error ? error.message : "Неизвестная ошибка");
      return "Не удалось завершить запуск. Проверьте настройки и повторите запрос.";
    },
  });

  return createUIMessageStreamResponse({
    stream,
    keepAliveMs: 15_000,
    headers: { "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
