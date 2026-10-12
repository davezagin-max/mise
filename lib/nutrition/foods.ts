/**
 * Typed access to the bundled nutrition subset. The JSON file is the source of
 * truth; read its `meta.provenance` before trusting a number.
 * Safe to import from server and client code.
 */
import data from "./foods.json";

export const AISLES = [
  "produce",
  "meat",
  "chilled",
  "bakery",
  "grains",
  "canned",
  "nuts",
  "condiments",
  "spices",
  "frozen",
] as const;
export type Aisle = (typeof AISLES)[number];

export const AISLE_LABELS: Record<Aisle | "other", string> = {
  produce: "Produce",
  meat: "Meat and fish",
  chilled: "Dairy, eggs and chilled",
  bakery: "Bakery",
  grains: "Grains and pasta",
  canned: "Cans and jars",
  nuts: "Nuts, seeds and dried fruit",
  condiments: "Oils, sauces and sweeteners",
  spices: "Dried herbs and spices",
  frozen: "Frozen",
  other: "Not in nutrition data",
};

export type Animal = "meat" | "fish" | "dairy" | "egg" | "honey";

export interface Food {
  id: string;
  name: string;
  aliases: string[];
  aisle: Aisle;
  /** Per 100 g. */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  /** Grams in one US cup. Without it, volume cannot be converted to mass. */
  cup?: number;
  /** Grams in one piece, by count unit (`each`, `clove`, `slice`, `can`...). */
  units?: Record<string, number>;
  /** Typical days it keeps. Missing means shelf-stable. */
  keeps?: number;
  animal?: Animal;
  staple?: boolean;
  liquid?: boolean;
  /** FoodData Central description, used as the search query when refreshing. */
  fdc: string;
}

export const FOODS = data.foods as unknown as Food[];
export const NUTRITION_META = data.meta;

const BY_ID = new Map(FOODS.map((food) => [food.id, food]));

export function foodById(id: string): Food | null {
  return BY_ID.get(id) ?? null;
}

/** Keeps a week or less: these are the foods the plan should use first. */
export const PERISHABLE_DAYS = 7;

export function isPerishable(food: Food): boolean {
  return food.keeps !== undefined && food.keeps <= PERISHABLE_DAYS;
}
