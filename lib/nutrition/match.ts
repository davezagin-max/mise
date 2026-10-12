/**
 * Matches an ingredient name, as a person or the model wrote it, to a food in
 * the bundled data.
 *
 * The match is deliberately strict. A name is normalised (case, punctuation,
 * plurals, preparation words such as "chopped" or "boneless") and must then be
 * exactly one of a food's names or aliases. There is no fuzzy scoring: "almond
 * butter" must never become "butter", and a miss is reported as "not in
 * nutrition data" instead of being guessed.
 *
 * "Fresh" is the one soft word: "fresh thyme" and "fresh mozzarella" are their
 * own foods, so it is kept for the first lookup and dropped only for a second
 * try ("fresh spinach" then finds "spinach").
 */
import { FOODS, type Food } from "./foods";

/** Words that describe preparation or size but not which food it is. */
const DESCRIPTORS = new Set([
  "freshly",
  "raw",
  "organic",
  "large",
  "medium",
  "small",
  "big",
  "ripe",
  "chopped",
  "diced",
  "sliced",
  "minced",
  "shredded",
  "grated",
  "crumbled",
  "peeled",
  "trimmed",
  "halved",
  "quartered",
  "cubed",
  "rinsed",
  "drained",
  "boneless",
  "skinless",
  "unsalted",
  "salted",
  "plain",
  "unsweetened",
  "finely",
  "roughly",
  "thinly",
  "of",
  "a",
  "the",
]);

const IRREGULAR: Record<string, string> = {
  leaves: "leaf",
  halves: "half",
  loaves: "loaf",
  tomatoes: "tomato",
  potatoes: "potato",
  mangoes: "mango",
};

function singular(word: string): string {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(sh|ch|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** The comparison key for a name. Exported for tests and for de-duplicating lists. */
export function normalizeName(raw: string): string {
  const text = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(low|reduced|no)[- ]sodium\b/g, " ")
    .replace(/\bextra[- ]virgin\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/%/g, " percent ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return text
    .split(" ")
    .filter((word) => word && !DESCRIPTORS.has(word))
    .map(singular)
    .join(" ");
}

function buildIndex(foods: Food[]): Map<string, Food> {
  const index = new Map<string, Food>();
  for (const food of foods) {
    for (const name of [food.name, food.id.replace(/-/g, " "), ...food.aliases]) {
      const key = normalizeName(name);
      if (key && !index.has(key)) index.set(key, food);
    }
  }
  return index;
}

const INDEX = buildIndex(FOODS);

/** Every normalised key and the food it points at. Used by the data-integrity test. */
export function aliasEntries(foods: Food[] = FOODS): { key: string; foodId: string }[] {
  return foods.flatMap((food) =>
    [food.name, food.id.replace(/-/g, " "), ...food.aliases].map((name) => ({
      key: normalizeName(name),
      foodId: food.id,
    })),
  );
}

/**
 * Foods looked up in FoodData Central for this visitor, by normalised name.
 * Consulted only after the bundled table, so they can never shadow it.
 */
let extras = new Map<string, Food>();

export function setExtraFoods(foods: Iterable<[string, Food]>): void {
  extras = new Map([...foods].map(([name, food]) => [normalizeName(name), food]));
}

function lookup(name: string): Food | null {
  const key = normalizeName(name);
  if (!key) return null;
  const direct = INDEX.get(key);
  if (direct) return direct;
  const words = key.split(" ");
  if (words.includes("fresh")) {
    const plain = INDEX.get(words.filter((word) => word !== "fresh").join(" "));
    if (plain) return plain;
  }
  return extras.get(key) ?? null;
}

/** The food this name refers to, or null when the data does not have it. */
export function matchFood(name: string): Food | null {
  const whole = lookup(name);
  if (whole) return whole;
  // "chicken breast, cut into strips": the part before the comma names the food.
  const comma = name.indexOf(",");
  return comma > 0 ? lookup(name.slice(0, comma)) : null;
}
