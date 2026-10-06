import type { RoundState } from "./rounds";

/**
 * Выводы по оценкам прогона. Модуль читает историю раундов и ничего больше:
 * ни файлов, ни агентов, ни состояния.
 */

/**
 * Итоговая оценка прогона — score последнего одобренного раунда.
 * null, если approve так и не случился: оценивать нечего, план не принят.
 */
export function finalScore(rounds: RoundState[]): number | null {
  const approved = rounds.filter((state) => state.review.verdict === "approve").at(-1);
  return approved ? approved.review.score : null;
}

/**
 * Вырос ли score на последней ревизии относительно предыдущего раунда.
 * Отвечает на вопрос «замечания ревьюера пошли плану на пользу?», поэтому
 * сравниваются именно соседние раунды, а не первый с последним.
 * Для единственного раунда сравнивать не с чем — false.
 */
export function improved(rounds: RoundState[]): boolean {
  if (rounds.length < 2) return false;

  const last = rounds[rounds.length - 1];
  const previous = rounds[rounds.length - 2];
  return last.review.score > previous.review.score;
}
