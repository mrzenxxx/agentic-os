import { z } from "zod";

const requestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    parts: z.array(z.object({ type: z.literal("text"), text: z.string().max(16_000) })).max(20),
  })).min(1).max(100),
});

/** История остаётся в странице: в harness и его trace идёт только новая задача. */
export function readChatTask(body: unknown): string {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) throw new Error("Некорректные сообщения чата");
  const last = parsed.data.messages.at(-1)!;
  if (last.role !== "user") throw new Error("Последнее сообщение должно быть от пользователя");
  const task = last.parts.map((part) => part.text).join("\n").trim();
  if (!task) throw new Error("Введите задачу");
  if (task.length > 8_000) throw new Error("Задача должна быть не длиннее 8000 символов");
  return task;
}
