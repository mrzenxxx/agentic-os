import { CheckCircle2, PencilLine, Stethoscope, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Review } from "@/src/agents/safetyReviewer";

export type Verdict = Review["verdict"];

type VerdictPresentation = {
  label: string;
  /** Что вердикт означает для пользователя, одной строкой. */
  summary: string;
  icon: LucideIcon;
  /** Классы бейджа. Цвет всегда идёт в паре с иконкой и текстом. */
  badge: string;
};

/**
 * Единственный источник правды по оформлению вердикта: цвет, иконка и подпись.
 * Статусные шкалы берём встроенные (emerald/amber/red), а не токены темы —
 * тема задаёт продуктовую палитру, а не семантику светофора.
 */
export const verdictConfig: Record<Verdict, VerdictPresentation> = {
  approve: {
    label: "approve",
    summary: "одобрено",
    icon: CheckCircle2,
    badge: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  revise: {
    label: "revise",
    summary: "не одобрено после 3 раундов",
    icon: PencilLine,
    badge: "bg-amber-100 text-amber-900 border-amber-300",
  },
  needs_human_professional: {
    label: "needs_human_professional",
    summary: "нужен специалист",
    icon: Stethoscope,
    badge: "bg-red-100 text-red-900 border-red-300",
  },
};

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const { label, icon: Icon, badge } = verdictConfig[verdict];

  return (
    <Badge variant="outline" className={cn("h-6 gap-1.5 px-2.5 font-mono text-xs", badge, className)}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

/** Порог совпадает с бейджем: 8+ — зелёный, 5–7 — янтарный, ниже — красный. */
function scoreTone(score: number) {
  if (score >= 8) return { bar: "bg-emerald-600", text: "text-emerald-900" };
  if (score >= 5) return { bar: "bg-amber-500", text: "text-amber-900" };
  return { bar: "bg-red-600", text: "text-red-900" };
}

export function ScoreMeter({ score, className }: { score: number; className?: string }) {
  const clamped = Math.min(10, Math.max(0, score));
  const tone = scoreTone(clamped);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground text-sm">Оценка ревьюера</span>
        <span className={cn("text-sm font-semibold tabular-nums", tone.text)}>{clamped}/10</span>
      </div>
      <div
        role="meter"
        aria-label="Оценка ревьюера"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuetext={`${clamped} из 10`}
        className="bg-muted h-2 w-full overflow-hidden rounded-full"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", tone.bar)}
          style={{ width: `${clamped * 10}%` }}
        />
      </div>
    </div>
  );
}

const MAX_ROUNDS = 3;

export function RoundsIndicator({ rounds, className }: { rounds: number; className?: string }) {
  const used = Math.min(MAX_ROUNDS, Math.max(0, rounds));

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground text-sm">Раундов ревью</span>
        <span className="text-sm font-semibold tabular-nums">
          {used} из {MAX_ROUNDS}
        </span>
      </div>
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: MAX_ROUNDS }, (_, index) => (
          <div
            key={index}
            className={cn("h-2 flex-1 rounded-full", index < used ? "bg-primary" : "bg-muted")}
          />
        ))}
      </div>
    </div>
  );
}
