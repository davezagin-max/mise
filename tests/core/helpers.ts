import type { MealPlan, Prefs, Recipe, Slot } from "@/lib/types";

export function recipe(id: string, partial: Partial<Recipe> = {}): Recipe {
  return {
    id,
    title: `Recipe ${id}`,
    minutes: 20,
    servings: 2,
    ingredients: [{ name: "white rice", quantity: 100, unit: "g", prep: "" }],
    steps: ["Cook it."],
    why: "",
    ...partial,
  };
}

/** A 7-day plan from a table of recipe ids: one row per day, [breakfast, lunch, dinner]. */
export function plan(recipes: Recipe[], table: [string, string, string][]): MealPlan {
  const slots: Slot[] = ["breakfast", "lunch", "dinner"];
  return {
    title: "Test week",
    summary: "",
    recipes,
    days: table.map((row, index) => ({
      day: index + 1,
      meals: row.map((recipeId, i) => ({ slot: slots[i], recipeId })),
    })),
  };
}

export const week = (b: string, l: string, d: string): [string, string, string][] =>
  Array.from({ length: 7 }, () => [b, l, d]);

export const prefs = (partial: Partial<Prefs> = {}): Prefs => ({
  diet: "omnivore",
  maxMinutes: 30,
  servings: 2,
  proteinTarget: 60,
  ...partial,
});
