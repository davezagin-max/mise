/**
 * When each recipe is actually cooked.
 *
 * A plan reuses recipes: Monday's dinner is Tuesday's lunch. The first meal
 * that uses a recipe is a cook; later meals within `LEFTOVER_DAYS` are
 * leftovers from that cook; a meal further out is a second cook that needs
 * fresh ingredients. Cook days are what the perishables check and the grocery
 * list's "buy later" note are measured against.
 */
import { SLOTS, type MealPlan, type Prefs, type Slot } from "../types";

/** Cooked food is planned to be eaten within this many days of cooking. */
export const LEFTOVER_DAYS = 3;

export interface CookEvent {
  recipeId: string;
  /** The day it is cooked (1 = today). */
  day: number;
  /** Every meal fed by this cook, in order. The first one is on `day`. */
  meals: { day: number; slot: Slot }[];
}

export function cookEvents(plan: MealPlan): CookEvent[] {
  const byRecipe = new Map<string, { day: number; slot: Slot }[]>();
  for (const day of plan.days) {
    for (const meal of day.meals) {
      const list = byRecipe.get(meal.recipeId) ?? [];
      list.push({ day: day.day, slot: meal.slot });
      byRecipe.set(meal.recipeId, list);
    }
  }
  const events: CookEvent[] = [];
  for (const [recipeId, meals] of byRecipe) {
    meals.sort((a, b) => a.day - b.day || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
    let current: CookEvent | null = null;
    for (const meal of meals) {
      if (!current || meal.day - current.day > LEFTOVER_DAYS) {
        current = { recipeId, day: meal.day, meals: [] };
        events.push(current);
      }
      current.meals.push(meal);
    }
  }
  return events.sort((a, b) => a.day - b.day || a.recipeId.localeCompare(b.recipeId));
}

/** How many meals in the week use this recipe. */
export function mealCount(plan: MealPlan, recipeId: string): number {
  let count = 0;
  for (const day of plan.days) {
    for (const meal of day.meals) if (meal.recipeId === recipeId) count += 1;
  }
  return count;
}

/** Visitor overrides of how many portions to make, by recipe id. */
export type PortionOverrides = Record<string, number>;

/**
 * Portions of a recipe to make across the week: one per person per meal that
 * uses it, unless the visitor changed it on the recipe card.
 */
export function portionsFor(
  plan: MealPlan,
  recipeId: string,
  prefs: Pick<Prefs, "servings">,
  overrides: PortionOverrides = {},
): number {
  const override = overrides[recipeId];
  if (Number.isFinite(override) && override > 0) return override;
  return mealCount(plan, recipeId) * prefs.servings;
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Day 3" is neutral about which weekday the visitor starts on. */
export function dayLabel(day: number): string {
  return `Day ${day}`;
}
