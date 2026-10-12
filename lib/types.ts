/** Shared shapes. No logic here. */

export type Confidence = "high" | "medium" | "low";
export const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

/** A named amount: the common base of pantry items and recipe ingredients. */
export interface Quantity {
  name: string;
  quantity: number;
  unit: string;
}

/** One thing found in the fridge photo (or typed in by the visitor). */
export interface ScanItem extends Quantity {
  confidence: Confidence;
  /** A short remark from the scan, such as "label partly hidden". May be empty. */
  note: string;
}

export interface ScanResult {
  items: ScanItem[];
  summary: string;
}

export type Slot = "breakfast" | "lunch" | "dinner";
export const SLOTS: Slot[] = ["breakfast", "lunch", "dinner"];

export interface RecipeIngredient extends Quantity {
  /** "diced", "at room temperature". May be empty. */
  prep: string;
}

export interface Recipe {
  id: string;
  title: string;
  /** Total time at the stove, in minutes. */
  minutes: number;
  /** Portions the ingredient list makes as written. */
  servings: number;
  ingredients: RecipeIngredient[];
  steps: string[];
  /** One or two sentences on why this dish is in the plan. */
  why: string;
}

export interface Meal {
  slot: Slot;
  recipeId: string;
}

export interface PlanDay {
  day: number;
  meals: Meal[];
}

export interface MealPlan {
  title: string;
  summary: string;
  recipes: Recipe[];
  days: PlanDay[];
}

export const DIETS = ["omnivore", "pescatarian", "vegetarian", "vegan"] as const;
export type Diet = (typeof DIETS)[number];
export const COOK_TIMES = [20, 30, 45, 60] as const;

export interface Prefs {
  diet: Diet;
  /** Longest acceptable cook time for one recipe, in minutes. */
  maxMinutes: number;
  /** People eating each meal. */
  servings: number;
  /** Grams of protein per person per day. */
  proteinTarget: number;
}

export const PREF_LIMITS = {
  servings: { min: 1, max: 8 },
  proteinTarget: { min: 40, max: 250, step: 5 },
} as const;
