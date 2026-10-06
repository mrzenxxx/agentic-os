import { tool } from "@openai/agents";
import { z } from "zod";

import { readDataFile } from "./dataFile";

/**
 * Скилл «любимые рецепты»: блюда, к которым пользователь возвращается сам.
 * План из знакомых блюд выполняется чаще, чем план из правильных, но чужих.
 */

const EMPTY = "Список любимых рецептов пуст: data/recipes.md не заполнен.";

/** Чистая функция скилла — весь файл рецептов целиком. */
export function listFavoriteRecipes(): string {
  return readDataFile("recipes.md", EMPTY);
}

export const listFavoriteRecipesTool = tool({
  name: "listFavoriteRecipes",
  description:
    "Возвращает подборку любимых рецептов пользователя: название, калорийность, белок, " +
    "время приготовления, продукты с граммовками и короткий способ приготовления. " +
    "Вызывай при составлении плана питания: собирать день лучше из блюд, которые " +
    "пользователь уже готовит. Список небольшой и фиксированный — это не вся его еда, " +
    "а опора; недостающие приёмы пищи придумывай сам с учётом профиля.",
  parameters: z.object({}),
  execute: async () => listFavoriteRecipes(),
});
