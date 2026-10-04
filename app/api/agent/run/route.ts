import { runHealthAgent } from "../../../../src/harness/runHealthAgent";

// Харнесс читает и пишет файлы в data/ и держит клиент OpenAI SDK — нужен Node,
// edge-рантайм не подойдёт. maxDuration поднят: три раунда коуч↔ревьюер
// укладываются в минуты, а не в дефолтные секунды.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { task?: unknown };
    const task = typeof body.task === "string" ? body.task.trim() : "";
    if (!task) {
      return Response.json({ error: "Задача не передана" }, { status: 400 });
    }

    const result = await runHealthAgent(task);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Неизвестная ошибка";
    console.error("Ошибка:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
