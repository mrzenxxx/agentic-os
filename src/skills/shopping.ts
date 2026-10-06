import { tool } from "@openai/agents";
import { z } from "zod";

import { writeDataFile } from "./dataFile";

/**
 * Скилл «список покупок»: превращает готовый план питания в перечень продуктов.
 *
 * Разбор детерминированный, без обращения к модели: план уже написан моделью,
 * и прогонять его через вторую — это лишний вызов там, где хватает регулярки.
 * Модель отвечает за то, ЧТО купить (она пишет граммовки в плане), скилл — за
 * то, чтобы это собралось в один список без потерь.
 */

export type ShoppingItem = { name: string; amount: string };
export type ShoppingListResult = {
  ok: true;
  path: string;
  items: ShoppingItem[];
};

/**
 * Позиция плана: название продукта и следом количество с единицей измерения —
 * «гречка 200 г», «творог — 150 г», «молоко 300 мл», «банан 1 шт».
 *
 * Название ограничено буквами и пробелами и не длиннее 40 символов: так в него
 * не утягивает половину предложения перед цифрой. Разделитель между названием и
 * количеством необязателен — в планах встречаются оба написания.
 *
 * Переводов строки в названии нет сознательно (`[^\S\n]` вместо `\s`): иначе
 * в продукт утягивало заголовок блюда со строки выше.
 */
const INGREDIENT =
  /([А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z \t-]{1,40}?)[ \t]*[—–:-]?[ \t]*(\d+(?:[.,]\d+)?)[ \t]*(кг|г|гр|мл|л|шт|ст\.?[ \t]?л\.?|ч\.?[ \t]?л\.?)(?![А-ЯЁа-яёA-Za-z])/gi;

/** Слова, с которых начинается фраза, а не продукт: «съесть», «добавить» и т.п. */
const LEADING_NOISE =
  /^(?:съесть|съешь|добавить|добавь|взять|возьми|выпить|выпей|приготовить|приготовь|порция|порции|около|примерно|плюс|ещё|также|затем|до|из|без|по|и|с|со|на|в)\s+/i;

/** Markdown-разметка и буллеты мешают разбору — снимаем их до поиска продуктов. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>]/g, " ")
    .replace(/^[^\S\n]*[-–—•][^\S\n]*/gm, " ")
    .replace(/^[^\S\n]*\d+[.)][^\S\n]*/gm, " ");
}

/**
 * Слова, после которых идёт число с единицей, но покупать нечего: вес тела,
 * целевые показатели, норма воды. Регулярка их не отличит — отличает список.
 */
const NOT_A_PRODUCT = /(?:^|\s)(?:вес|цел[ьи]|пульс|норм[аы]|итого|всего|дефицит|профицит)(?:\s|$)/i;

function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().replace(LEADING_NOISE, "").trim();
  return name.toLowerCase();
}

/**
 * Извлекает продукты из markdown-плана и пишет их в `data/shopping.md`.
 *
 * Дубли схлопываются по названию: один продукт — одна строка, количества
 * перечисляются через запятую. Складывать их нельзя — в плане встречаются
 * разные единицы для одного продукта (молоко 300 мл в завтраке, 1 л на день).
 *
 * Падежи не нормализуются: «на молоке» и «молоко» остаются разными строками.
 * Лемматизация потребовала бы словаря, а список читает человек — он эти две
 * строки сведёт сам, в отличие от потерянного продукта.
 */
export function generateShoppingList(planMarkdown: string): ShoppingListResult {
  const plain = stripMarkdown(planMarkdown);
  const found = new Map<string, Set<string>>();

  for (const match of plain.matchAll(INGREDIENT)) {
    const name = cleanName(match[1]);
    if (name.length < 3 || NOT_A_PRODUCT.test(name)) continue;

    const amount = `${match[2].replace(",", ".")} ${match[3].toLowerCase().replace(/\s+/g, "")}`;
    const amounts = found.get(name) ?? new Set<string>();
    amounts.add(amount);
    found.set(name, amounts);
  }

  const items: ShoppingItem[] = [...found].map(([name, amounts]) => ({
    name,
    amount: [...amounts].join(", "),
  }));

  const body = items.length
    ? items.map((item) => `- ${item.name} — ${item.amount}`).join("\n")
    : "_В плане не нашлось продуктов с количеством._";
  const path = writeDataFile("shopping.md", `# Список покупок\n\n${body}\n`);

  return { ok: true, path, items };
}

export const generateShoppingListTool = tool({
  name: "generateShoppingList",
  description:
    "Собирает список покупок из готового плана питания и сохраняет его в data/shopping.md. " +
    "Передавай текст плана целиком — инструмент сам находит в нём продукты с количеством " +
    "(«творог 200 г», «молоко 300 мл») и схлопывает повторы. Вызывай, когда пользователь " +
    "просит список покупок или когда план питания имеет смысл закрыть закупкой. " +
    "Продукты без указанного количества в список не попадут, поэтому сначала убедись, " +
    "что в плане у каждой позиции есть граммовка или штуки.",
  parameters: z.object({
    planMarkdown: z
      .string()
      .min(1)
      .describe("Полный текст плана питания в markdown, из которого нужно собрать покупки."),
  }),
  execute: async ({ planMarkdown }) => generateShoppingList(planMarkdown),
});
