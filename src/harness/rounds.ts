import type { Review } from "./validateReview";

/**
 * Состояние раундов коуч ↔ ревьюер: что было сгенерировано и как это оценили.
 * Модуль хранит историю и ничего не решает — развилку по вердикту делает оркестратор.
 */

export type RoundState = {
  /** Номер раунда, начиная с 1. */
  round: number;
  /** План, который коуч выдал в этом раунде. */
  plan: string;
  /** Ревью этого плана. */
  review: Review;
};

export type RoundsLog = {
  /** Записывает завершённый раунд и возвращает его состояние. */
  record: (plan: string, review: Review) => RoundState;
  /** Вся история по порядку. */
  all: () => RoundState[];
  /** Последний записанный раунд или null, если прогон не дошёл ни до одного. */
  last: () => RoundState | null;
  /** Сколько раундов уже записано. */
  count: () => number;
};

export function createRoundsLog(): RoundsLog {
  const rounds: RoundState[] = [];

  return {
    record(plan, review) {
      const state: RoundState = { round: rounds.length + 1, plan, review };
      rounds.push(state);
      return state;
    },
    all: () => [...rounds],
    last: () => rounds.at(-1) ?? null,
    count: () => rounds.length,
  };
}
