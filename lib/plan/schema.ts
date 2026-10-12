/**
 * The plan's wire format and the tidy-up that runs after it.
 *
 * The wire schema constrains Claude's structured output. It has no place for
 * calories or macros on purpose: there is no field the model could put a
 * number in that the app would read. Limits the API cannot express (counts,
 * ranges, lengths) are enforced afterwards by `checkPlan`.
 */
import { z } from "zod";
import { cleanText } from "../scan/schema";
import { DIETS, PREF_LIMITS, SLOTS, type MealPlan } from "../types";
import { parseUnit } from "../units";

/** The `/api/plan` request: the confirmed ingredient list and the visitor's preferences. */
export const PlanBody = z.object({
  demoId: z.string().max(64).optional(),
  ingredients: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        quantity: z.number().positive().max(10_000),
        unit: z.string().max(24),
      }),
    )
    .min(1)
    .max(80),
  prefs: z.object({
    diet: z.enum(DIETS),
    maxMinutes: z.number().int().min(10).max(180),
    servings: z.number().int().min(PREF_LIMITS.servings.min).max(PREF_LIMITS.servings.max),
    proteinTarget: z
      .number()
      .min(PREF_LIMITS.proteinTarget.min)
      .max(PREF_LIMITS.proteinTarget.max),
  }),
});
export type PlanBodyData = z.infer<typeof PlanBody>;

export const PlanWire = z.object({
  title: z.string(),
  summary: z.string(),
  recipes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      minutes: z.number(),
      servings: z.number(),
      ingredients: z.array(
        z.object({
          name: z.string(),
          quantity: z.number(),
          unit: z.string(),
          prep: z.string(),
        }),
      ),
      steps: z.array(z.string()),
      why: z.string(),
    }),
  ),
  days: z.array(
    z.object({
      day: z.number(),
      meals: z.array(
        z.object({
          slot: z.enum(["breakfast", "lunch", "dinner"]),
          recipeId: z.string(),
        }),
      ),
    }),
  ),
});
export type PlanWireData = z.infer<typeof PlanWire>;

const TEXT = { title: 100, summary: 320, why: 240, step: 400, name: 80, prep: 80, unit: 24 };

/**
 * Cleans a parsed plan without changing what it says: text trimmed and capped,
 * units put in canonical form, whole numbers where the app needs them, days
 * and meals in order, and recipes that no meal uses dropped.
 */
export function normalizePlan(raw: PlanWireData): MealPlan {
  const used = new Set(raw.days.flatMap((day) => day.meals.map((meal) => meal.recipeId.trim())));
  return {
    title: cleanText(raw.title, TEXT.title),
    summary: cleanText(raw.summary, TEXT.summary),
    recipes: raw.recipes
      .map((recipe) => ({
        id: recipe.id.trim(),
        title: cleanText(recipe.title, TEXT.title),
        minutes: Math.round(recipe.minutes),
        servings: Math.round(recipe.servings),
        ingredients: recipe.ingredients.map((ingredient) => ({
          name: cleanText(ingredient.name, TEXT.name),
          quantity: ingredient.quantity,
          unit: parseUnit(ingredient.unit)?.id ?? cleanText(ingredient.unit, TEXT.unit),
          prep: cleanText(ingredient.prep, TEXT.prep),
        })),
        steps: recipe.steps.map((step) => cleanText(step, TEXT.step)).filter(Boolean),
        why: cleanText(recipe.why, TEXT.why),
      }))
      .filter((recipe) => used.has(recipe.id)),
    days: raw.days
      .map((day) => ({
        day: Math.round(day.day),
        meals: day.meals
          .map((meal) => ({ slot: meal.slot, recipeId: meal.recipeId.trim() }))
          .sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot)),
      }))
      .sort((a, b) => a.day - b.day),
  };
}

/** What `/api/plan` returns. */
export interface PlanData {
  plan: MealPlan;
  /** Model calls it took: 1, or 2 when the code's checks sent the first draft back. */
  attempts: number;
  /** The check findings the first draft was sent back for. Empty when `attempts` is 1. */
  revisedFor: string[];
}
