"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, Play } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  RoundsHistory,
  RoundsIndicator,
  ReviewIssues,
  RunMeta,
  ScoreMeter,
  ToolCallsList,
  VerdictBadge,
  verdictConfig,
} from "@/components/health/review-widgets";
import type { HealthAgentResult } from "@/src/harness/runHealthAgent";

type State =
  | { status: "idle" }
  | { status: "running" }
  | { status: "result"; result: HealthAgentResult }
  | { status: "error"; message: string };

const REVIEW_STEPS = [
  "Коуч сам решает, какие данные ему нужны: профиль, дневник, рецепты, шаблоны тренировок.",
  "Safety Reviewer проверяет план на безопасность, реалистичность и соответствие профилю.",
  "Если есть замечания, план переписывается — до трёх раундов.",
  "Одобренный план агент сохраняет в файл: до approve этот инструмент ему недоступен.",
];

export default function Page() {
  const [task, setTask] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const running = state.status === "running";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (running) return;

    if (!task.trim()) {
      setFieldError("Введите задачу — например, «составь план питания на завтра».");
      textareaRef.current?.focus();
      return;
    }

    setFieldError(null);
    setState({ status: "running" });
    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      const data = await response.json();
      if (!response.ok) {
        setState({ status: "error", message: data.error ?? `Ошибка ${response.status}` });
        return;
      }
      setState({ status: "result", result: data as HealthAgentResult });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Сеть недоступна" });
    }
  }

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Health Coach Agent</h1>
        <p className="text-muted-foreground mt-2 max-w-[60ch] text-sm sm:text-base">
          Коуч составляет план по профилю и дневнику, Safety Reviewer проверяет его перед выдачей.
        </p>
      </header>

      <Card>
        <CardContent>
          <form onSubmit={handleSubmit} aria-busy={running} className="space-y-3">
            <Label htmlFor="task">Задача</Label>
            <Textarea
              id="task"
              name="task"
              ref={textareaRef}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              disabled={running}
              rows={4}
              aria-invalid={fieldError !== null}
              aria-describedby={fieldError ? "task-error task-hint" : "task-hint"}
              placeholder="Например: составь план питания на завтра"
            />
            {fieldError && (
              <p id="task-error" className="text-destructive text-sm">
                {fieldError}
              </p>
            )}
            <p id="task-hint" className="text-muted-foreground text-sm">
              Один запрос — один ответ. Прогон занимает 1–4 минуты: каждый раунд это два обращения к модели.
            </p>
            <Button type="submit" size="lg" disabled={running} className="min-h-11 px-5">
              {running ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Агент работает
                </>
              ) : (
                <>
                  <Play aria-hidden="true" />
                  Run Agent
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div aria-live="polite" className="mt-6">
        {state.status === "idle" && <EmptyState />}
        {running && <RunningState />}
        {state.status === "error" && (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Прогон не удался</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}
        {state.status === "result" && <Result result={state.result} />}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <Card className="bg-muted/40 border-dashed shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Как проходит прогон</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
          {REVIEW_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** Счётчик нужен потому, что прогон идёт минутами: без него пауза читается как зависание. */
function RunningState() {
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const id = setInterval(() => setSeconds(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-normal">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Агент работает… {seconds} с
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-2 w-full" />
        <Separator className="my-4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </CardContent>
    </Card>
  );
}

function Result({ result }: { result: HealthAgentResult }) {
  const { plan, review, rounds, toolCalls, improved, promptVersions, durationMs } = result;
  const needsProfessional = review.verdict === "needs_human_professional";

  return (
    <div className="space-y-4">
      {needsProfessional && (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Этот запрос требует консультации специалиста</AlertTitle>
          <AlertDescription>
            Ревьюер отнёс запрос к медицинским, поэтому план не выдаётся и не сохраняется.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-x-3 gap-y-2 text-base">
            Safety Review
            <VerdictBadge verdict={review.verdict} />
            <span className="text-muted-foreground text-sm font-normal">
              {verdictConfig[review.verdict].summary}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <ScoreMeter score={review.score} />
            <RoundsIndicator rounds={rounds.length} />
          </div>

          <Separator />

          <ReviewIssues issues={review.issues} defaultOpen={needsProfessional} />

          <Separator />

          <div className="space-y-3">
            <RunMeta durationMs={durationMs} promptVersions={promptVersions} />
            <RoundsHistory rounds={rounds} improved={improved} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Что сделал агент</CardTitle>
        </CardHeader>
        <CardContent>
          <ToolCallsList toolCalls={toolCalls} />
        </CardContent>
      </Card>

      {!needsProfessional && plan && <PlanCard plan={plan} />}
    </div>
  );
}

function PlanCard({ plan }: { plan: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  async function copyPlan() {
    try {
      await navigator.clipboard.writeText(plan);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">План</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={copyPlan}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Скопировано" : "Копировать"}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="max-w-[68ch] text-sm leading-relaxed whitespace-pre-wrap">{plan}</div>
      </CardContent>
    </Card>
  );
}
