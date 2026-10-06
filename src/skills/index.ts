import { getProfileTool } from "./profile";
import { getRecentLogTool } from "./logs";
import { generateShoppingListTool } from "./shopping";
import { listFavoriteRecipesTool } from "./recipes";
import { suggestWorkoutTemplateTool } from "./workouts";
import { savePlanTool } from "./plans";

/**
 * Наборы инструментов коуча — два простых массива, без реестра и регистрации.
 * Какой набор уходит в агента, решает харнесс, и это единственная развилка.
 */

/**
 * Инструменты фазы генерации: чтение контекста и побочные действия, безопасные
 * до одобрения плана. savePlanTool сюда не входит сознательно — на этой фазе
 * одобренного плана ещё не существует (см. комментарий в skills/plans.ts).
 */
export const PLANNING_TOOLS = [
  getProfileTool,
  getRecentLogTool,
  listFavoriteRecipesTool,
  suggestWorkoutTemplateTool,
  generateShoppingListTool,
];

/** Инструменты фазы сохранения: доступны только после approve ревьюера. */
export const SAVING_TOOLS = [savePlanTool];

export { savePlanTool };
