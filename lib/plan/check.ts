/**
 * Deterministic checks on a meal plan. The model writes the plan; this decides
 * whether it is acceptable and computes every figure shown beside it.
 *
 * Errors make a plan unusable (wrong shape, breaks the diet, over the cook
 * time). Warnings are shown to the visitor and, on a live run, sent back to
 * the model once so it can revise (a day short on protein, a perishable left
 * too late).
 */
import {
  DIETS,
  SLOTS,
  type Diet,
  type MealPlan,
  type Prefs,
  type Quantity,
  type Recipe,
} from "../types";
import { isPerishable, type Animal, type Food } from "../nutrition/foods";
import {
  ZERO_MACROS,
  addMacros,
  recipeNutrition,
  type Macros,
  type RecipeNutrition,
} from "../nutrition/macros";
import { matchFood, normalizeName } from "../nutrition/match";
import { cookEvents } from "./schedule";

export const LIMITS = {
  days: 7,
  maxRecipes: 14,
  maxIngredients: 24,
  maxSteps: 12,
  maxServings: 12,
  maxQuantity: 10_000,
} as const;

/** A day counts as on target at 90% of the protein goal. */
export const PROTEIN_TOLERANCE = 0.9;
/** Below this share of ingredients counted, the totals are too incomplete to trust. */
export const MIN_COVERAGE = 0.8;

export type IssueCode =
  | "structure"
  | "over-time"
  | "diet"
  | "diet-unverified"
  | "protein-short"
  | "late-perishable"
  | "unused-perishable"
  | "low-coverage";

export interface Issue {
  code: IssueCode;
  message: string;
  day?: number;
  recipeId?: string;
}

export interface DayReport {
  day: number;
  /** One person's intake for the day. */
  macros: Macros;
  proteinOk: boolean;
}

export interface PerishableUse {
  foodId: string;
  name: string;
  keeps: number;
  /** First day a recipe using it is cooked, or null when the plan never uses it. */
  firstDay: number | null;
  status: "ok" | "late" | "unused";
}

export interface PlanReport {
  errors: Issue[];
  warnings: Issue[];
  days: DayReport[];
  coverage: { counted: number; total: number; missing: string[] };
  /** On-hand foods that keep a week or less, most urgent first. */
  perishables: PerishableUse[];
  /** How many on-hand foods the plan uses. */
  pantry: { used: number; total: number };
}

const FORBIDDEN: Record<Diet, Animal[]> = {
  omnivore: [],
  pescatarian: ["meat"],
  vegetarian: ["meat", "fish"],
  vegan: ["meat", "fish", "dairy", "egg", "honey"],
};

/**
 * Words that suggest an animal product in an ingredient the data does not
 * know. A hit is only a warning: the code cannot verify what it cannot match.
 */
const HINTS: Record<Animal, string[]> = {
  meat: [
    "chicken",
    "beef",
    "pork",
    "bacon",
    "ham",
    "turkey",
    "lamb",
    "sausage",
    "duck",
    "veal",
    "steak",
    "prosciutto",
    "chorizo",
    "pepperoni",
    "salami",
    "gelatin",
    "lard",
  ],
  fish: [
    "fish",
    "salmon",
    "tuna",
    "shrimp",
    "prawn",
    "anchovy",
    "crab",
    "lobster",
    "cod",
    "tilapia",
    "sardine",
    "scallop",
    "clam",
    "mussel",
    "oyster",
  ],
  dairy: ["milk", "cheese", "butter", "cream", "yogurt", "whey", "ghee"],
  egg: ["egg"],
  honey: ["honey"],
};

const ANIMAL_TEXT: Record<Animal, string> = {
  meat: "meat",
  fish: "fish or shellfish",
  dairy: "dairy",
  egg: "egg",
  honey: "honey",
};

function structureErrors(plan: MealPlan): Issue[] {
  const errors: Issue[] = [];
  const fail = (message: string, extra: Partial<Issue> = {}) =>
    errors.push({ code: "structure", message, ...extra });

  if (!plan.title.trim()) fail("The plan has no title.");
  if (plan.recipes.length === 0) fail("The plan has no recipes.");
  if (plan.recipes.length > LIMITS.maxRecipes) {
    fail(`The plan has ${plan.recipes.length} recipes; the limit is ${LIMITS.maxRecipes}.`);
  }

  const ids = new Set<string>();
  for (const recipe of plan.recipes) {
    const at = { recipeId: recipe.id };
    if (!recipe.id.trim()) fail("A recipe has no id.");
    if (ids.has(recipe.id)) fail(`Recipe id "${recipe.id}" is used twice.`, at);
    ids.add(recipe.id);
    if (!recipe.title.trim()) fail(`Recipe "${recipe.id}" has no title.`, at);
    if (!Number.isFinite(recipe.servings) || recipe.servings < 1) {
      fail(`"${recipe.title}" must make at least 1 serving.`, at);
    } else if (recipe.servings > LIMITS.maxServings) {
      fail(`"${recipe.title}" makes more than ${LIMITS.maxServings} servings.`, at);
    }
    if (!Number.isFinite(recipe.minutes) || recipe.minutes < 1) {
      fail(`"${recipe.title}" has no cook time.`, at);
    }
    if (recipe.ingredients.length === 0) fail(`"${recipe.title}" has no ingredients.`, at);
    if (recipe.ingredients.length > LIMITS.maxIngredients) {
      fail(`"${recipe.title}" has more than ${LIMITS.maxIngredients} ingredients.`, at);
    }
    if (recipe.steps.length === 0) fail(`"${recipe.title}" has no steps.`, at);
    if (recipe.steps.length > LIMITS.maxSteps) {
      fail(`"${recipe.title}" has more than ${LIMITS.maxSteps} steps.`, at);
    }
    for (const ingredient of recipe.ingredients) {
      if (!ingredient.name.trim()) fail(`"${recipe.title}" has an unnamed ingredient.`, at);
      if (
        !Number.isFinite(ingredient.quantity) ||
        ingredient.quantity <= 0 ||
        ingredient.quantity > LIMITS.maxQuantity
      ) {
        fail(`"${recipe.title}": ${ingredient.name} has an invalid quantity.`, at);
      }
    }
  }

  const days = plan.days.map((d) => d.day).sort((a, b) => a - b);
  const expected = Array.from({ length: LIMITS.days }, (_, i) => i + 1);
  if (days.length !== LIMITS.days || days.some((day, i) => day !== expected[i])) {
    fail(`The plan must have exactly ${LIMITS.days} days, numbered 1 to ${LIMITS.days}.`);
  }
  for (const day of plan.days) {
    const slots = day.meals.map((meal) => meal.slot).sort();
    if (slots.length !== SLOTS.length || [...SLOTS].sort().some((slot, i) => slot !== slots[i])) {
      fail(`Day ${day.day} must have exactly one breakfast, one lunch and one dinner.`, {
        day: day.day,
      });
    }
    for (const meal of day.meals) {
      if (!ids.has(meal.recipeId)) {
        fail(`Day ${day.day} ${meal.slot} refers to a recipe that does not exist.`, {
          day: day.day,
        });
      }
    }
  }
  return errors;
}

function dietIssues(
  recipe: Recipe,
  nutrition: RecipeNutrition,
  diet: Diet,
): { errors: Issue[]; warnings: Issue[] } {
  const forbidden = FORBIDDEN[diet];
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (forbidden.length === 0) return { errors, warnings };
  recipe.ingredients.forEach((ingredient, index) => {
    const line = nutrition.lines[index];
    if (line.status !== "unmatched") {
      const animal = line.food.animal;
      if (animal && forbidden.includes(animal)) {
        errors.push({
          code: "diet",
          recipeId: recipe.id,
          message: `"${recipe.title}" uses ${line.food.name} (${ANIMAL_TEXT[animal]}), which a ${diet} plan cannot include.`,
        });
      }
      return;
    }
    const words = normalizeName(ingredient.name).split(" ");
    const hit = forbidden.find((animal) => HINTS[animal].some((word) => words.includes(word)));
    if (hit) {
      warnings.push({
        code: "diet-unverified",
        recipeId: recipe.id,
        message: `"${recipe.title}" lists "${ingredient.name}", which is not in the nutrition data and may contain ${ANIMAL_TEXT[hit]}. Check it against your ${diet} diet.`,
      });
    }
  });
  return { errors, warnings };
}

function isDiet(value: string): value is Diet {
  return (DIETS as readonly string[]).includes(value);
}

/** The foods on hand, one entry per distinct food the data knows. */
export function pantryFoods(pantry: Quantity[]): Food[] {
  const seen = new Map<string, Food>();
  for (const item of pantry) {
    const food = matchFood(item.name);
    if (food && !seen.has(food.id)) seen.set(food.id, food);
  }
  return [...seen.values()];
}

export function checkPlan(plan: MealPlan, prefs: Prefs, pantry: Quantity[]): PlanReport {
  const report: PlanReport = {
    errors: structureErrors(plan),
    warnings: [],
    days: [],
    coverage: { counted: 0, total: 0, missing: [] },
    perishables: [],
    pantry: { used: 0, total: 0 },
  };
  // The numeric checks assume a well-formed plan.
  if (report.errors.length > 0) return report;

  const diet: Diet = isDiet(prefs.diet) ? prefs.diet : "omnivore";
  const nutrition = new Map<string, RecipeNutrition>();
  const usedFoods = new Map<string, string[]>();
  const missing = new Set<string>();

  for (const recipe of plan.recipes) {
    const facts = recipeNutrition(recipe);
    nutrition.set(recipe.id, facts);
    report.coverage.total += facts.lines.length;
    report.coverage.counted += facts.counted;
    facts.missing.forEach((name) => missing.add(name));

    if (recipe.minutes > prefs.maxMinutes) {
      report.errors.push({
        code: "over-time",
        recipeId: recipe.id,
        message: `"${recipe.title}" takes ${recipe.minutes} minutes; the limit is ${prefs.maxMinutes}.`,
      });
    }
    const found = dietIssues(recipe, facts, diet);
    report.errors.push(...found.errors);
    report.warnings.push(...found.warnings);

    for (const line of facts.lines) {
      if (line.status === "unmatched") continue;
      const list = usedFoods.get(line.food.id) ?? [];
      if (!list.includes(recipe.id)) list.push(recipe.id);
      usedFoods.set(line.food.id, list);
    }
  }
  report.coverage.missing = [...missing].sort();

  for (const day of [...plan.days].sort((a, b) => a.day - b.day)) {
    let macros = ZERO_MACROS;
    for (const meal of day.meals) {
      const facts = nutrition.get(meal.recipeId);
      if (facts) macros = addMacros(macros, facts.perServing);
    }
    const proteinOk = macros.protein >= prefs.proteinTarget * PROTEIN_TOLERANCE;
    report.days.push({ day: day.day, macros, proteinOk });
    if (!proteinOk) {
      report.warnings.push({
        code: "protein-short",
        day: day.day,
        message: `Day ${day.day} has ${Math.round(macros.protein)} g of protein per person against a target of ${prefs.proteinTarget} g.`,
      });
    }
  }

  if (
    report.coverage.total > 0 &&
    report.coverage.counted / report.coverage.total < MIN_COVERAGE
  ) {
    report.warnings.push({
      code: "low-coverage",
      message: `Only ${report.coverage.counted} of ${report.coverage.total} ingredients are in the nutrition data, so the totals understate the plan.`,
    });
  }

  const firstCook = new Map<string, number>();
  for (const event of cookEvents(plan)) {
    if (!firstCook.has(event.recipeId)) firstCook.set(event.recipeId, event.day);
  }
  const onHand = pantryFoods(pantry);
  report.pantry.total = onHand.length;
  for (const food of onHand) {
    const recipes = usedFoods.get(food.id) ?? [];
    if (recipes.length > 0) report.pantry.used += 1;
    if (!isPerishable(food) || food.keeps === undefined) continue;
    const days = recipes
      .map((id) => firstCook.get(id))
      .filter((day): day is number => day !== undefined);
    const firstDay = days.length > 0 ? Math.min(...days) : null;
    const status = firstDay === null ? "unused" : firstDay > food.keeps ? "late" : "ok";
    report.perishables.push({ foodId: food.id, name: food.name, keeps: food.keeps, firstDay, status });
    if (status === "late") {
      report.warnings.push({
        code: "late-perishable",
        day: firstDay ?? undefined,
        message: `${food.name} keeps about ${food.keeps} days but is first cooked on day ${firstDay}.`,
      });
    } else if (status === "unused") {
      report.warnings.push({
        code: "unused-perishable",
        message: `${food.name} is on hand and keeps about ${food.keeps} days, but no recipe uses it.`,
      });
    }
  }
  report.perishables.sort((a, b) => a.keeps - b.keeps || a.name.localeCompare(b.name));
  return report;
}

/** Issues worth one revision round on a live run. Unused food is advice, not a fault. */
export function needsRevision(report: PlanReport): Issue[] {
  return [
    ...report.errors,
    ...report.warnings.filter(
      (issue) => issue.code === "protein-short" || issue.code === "late-perishable",
    ),
  ];
}
