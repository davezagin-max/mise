/**
 * Macro arithmetic. Every calorie and gram of protein the app shows comes from
 * here: an ingredient is matched to a food, converted to grams, and multiplied
 * by that food's per-100g figures. The model never supplies a number.
 *
 * An ingredient that cannot be matched or converted is left out of the totals
 * and reported, so a total is always a lower bound the visitor can see the
 * gaps in, never a guess.
 */
import { toGrams, type GramFailure, type UnitKind } from "../units";
import type { MealPlan, Quantity, Recipe } from "../types";
import type { Food } from "./foods";
import { matchFood } from "./match";

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export const ZERO_MACROS: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

export function addMacros(a: Macros, b: Macros): Macros {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
    fiber: a.fiber + b.fiber,
  };
}

export function scaleMacros(m: Macros, factor: number): Macros {
  return {
    kcal: m.kcal * factor,
    protein: m.protein * factor,
    carbs: m.carbs * factor,
    fat: m.fat * factor,
    fiber: m.fiber * factor,
  };
}

/** Macros in `grams` of a food. */
export function macrosForGrams(food: Food, grams: number): Macros {
  return scaleMacros(food, grams / 100);
}

export type Resolved =
  | { status: "ok"; food: Food; grams: number; via: UnitKind; macros: Macros }
  /** The name is not in the nutrition data. */
  | { status: "unmatched" }
  /** The food is known but this quantity cannot become grams. */
  | { status: "unconvertible"; food: Food; reason: GramFailure };

export function resolve(item: Quantity): Resolved {
  const food = matchFood(item.name);
  if (!food) return { status: "unmatched" };
  const grams = toGrams(item.quantity, item.unit, food);
  if (!grams.ok) return { status: "unconvertible", food, reason: grams.reason };
  return {
    status: "ok",
    food,
    grams: grams.grams,
    via: grams.via,
    macros: macrosForGrams(food, grams.grams),
  };
}

export interface RecipeNutrition {
  /** The whole recipe as written. */
  total: Macros;
  perServing: Macros;
  /** One entry per ingredient, in recipe order. */
  lines: Resolved[];
  counted: number;
  /** Names of the ingredients left out of the totals. */
  missing: string[];
}

export function recipeNutrition(recipe: Recipe): RecipeNutrition {
  const lines = recipe.ingredients.map(resolve);
  let total = ZERO_MACROS;
  const missing: string[] = [];
  lines.forEach((line, index) => {
    if (line.status === "ok") total = addMacros(total, line.macros);
    else missing.push(recipe.ingredients[index].name);
  });
  const servings = recipe.servings > 0 ? recipe.servings : 1;
  return {
    total,
    perServing: scaleMacros(total, 1 / servings),
    lines,
    counted: lines.length - missing.length,
    missing,
  };
}

/** The same recipe written for a different number of portions. */
export function scaleRecipe(recipe: Recipe, portions: number): Recipe {
  if (!Number.isFinite(portions) || portions <= 0 || recipe.servings <= 0) return recipe;
  const factor = portions / recipe.servings;
  return {
    ...recipe,
    servings: portions,
    ingredients: recipe.ingredients.map((ingredient) => ({
      ...ingredient,
      quantity: ingredient.quantity * factor,
    })),
  };
}

/** What one person eats on one day: a serving of each meal's recipe. */
export function dayMacros(plan: MealPlan, day: number): Macros {
  const entry = plan.days.find((d) => d.day === day);
  if (!entry) return ZERO_MACROS;
  let total = ZERO_MACROS;
  for (const meal of entry.meals) {
    const recipe = plan.recipes.find((r) => r.id === meal.recipeId);
    if (recipe) total = addMacros(total, recipeNutrition(recipe).perServing);
  }
  return total;
}

/**
 * Sanity band for a food's stated energy against its own macros (Atwater: 4
 * kcal per gram of protein and carbohydrate, 9 per gram of fat, fibre counted
 * at about 2). Used by the data-integrity test to catch mistyped rows.
 */
export function energyBand(food: Pick<Food, "protein" | "carbs" | "fat" | "fiber">): {
  low: number;
  high: number;
} {
  const plain = 4 * food.protein + 4 * food.carbs + 9 * food.fat;
  const fibreAware = plain - 2 * Math.min(food.fiber, food.carbs);
  return { low: fibreAware * 0.85 - 8, high: plain * 1.15 + 8 };
}
