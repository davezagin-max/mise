/**
 * The grocery list: what the plan needs, minus what is on hand.
 *
 * Both sides are converted to grams per food, because that is the only unit in
 * which "2 cups of spinach in the plan" and "1 bag (150 g) in the fridge" can
 * be compared. When either side cannot be converted the item is marked "check"
 * instead of being silently subtracted or silently bought.
 */
import { AISLES, AISLE_LABELS, isPerishable, type Aisle, type Food } from "./nutrition/foods";
import { resolve } from "./nutrition/macros";
import { normalizeName } from "./nutrition/match";
import { cookEvents, portionsFor, type PortionOverrides } from "./plan/schedule";
import type { MealPlan, Prefs, Quantity } from "./types";
import { CUP_ML, convert, formatAmount, formatGrams, parseUnit } from "./units";

export type GroceryStatus = "buy" | "covered" | "check" | "staple";

export interface GroceryItem {
  /** Stable across re-renders and reloads; the check-off state is stored against it. */
  key: string;
  name: string;
  aisle: Aisle | "other";
  status: GroceryStatus;
  /** What to buy ("3", "2 cans", "450 g") or, for other statuses, what the plan needs. */
  amount: string;
  /** Secondary line: the weight behind a count, or how need compares with stock. */
  detail: string;
  needGrams: number | null;
  haveGrams: number | null;
  buyGrams: number | null;
  perishable: boolean;
  keeps: number | null;
  /** First and last day a recipe using it is cooked. */
  firstDay: number;
  lastDay: number;
  /** Timing advice for perishables. */
  note: string | null;
  usedIn: string[];
}

export interface GroceryGroup {
  aisle: Aisle | "other";
  label: string;
  items: GroceryItem[];
}

export interface GroceryList {
  /** Things to buy, by aisle, perishables first. */
  groups: GroceryGroup[];
  /** On hand but not comparable: look before you shop. */
  check: GroceryItem[];
  /** Pantry staples the plan uses and the scan did not see. */
  staples: GroceryItem[];
  /** Fully covered by what is on hand. */
  covered: GroceryItem[];
  buyCount: number;
}

interface Need {
  food: Food | null;
  name: string;
  grams: number;
  /** Amounts that could not become grams, summed per unit. */
  loose: Map<string, number>;
  recipes: Set<string>;
  firstDay: number;
  lastDay: number;
}

interface Have {
  grams: number;
  /** Something is on hand in a unit that cannot become grams. */
  unknown: boolean;
  loose: Map<string, number>;
}

/** Count units a shopper buys by, most natural first. `each` is handled separately. */
const PURCHASE_UNITS = ["can", "jar", "block", "head", "bunch", "fillet", "link", "ear", "slice"];
/** Below this weight per piece, a count is silly ("31 cherry tomatoes"); use weight. */
const MIN_PIECE_GRAMS = 25;
/** A shortfall under 2% (or 1 g) is rounding, not a trip to the shop. */
const COVERED_SLACK = 0.02;

function looseText(loose: Map<string, number>): string {
  return [...loose].map(([unit, quantity]) => formatAmount(quantity, unit)).join(" + ");
}

function ounces(grams: number): string {
  const oz = grams / 28.349523125;
  if (oz >= 16) return `${Number((oz / 16).toFixed(1))} lb`;
  return `${Number(oz.toFixed(oz < 10 ? 1 : 0))} oz`;
}

/** The count unit this food is bought by, or null when it is bought by weight or volume. */
function purchaseUnit(food: Food): string | null {
  const pieces = food.units ?? {};
  // Bread and bacon are bought by the slice; cheese that happens to have a slice weight is not.
  const sliced = food.aisle === "bakery" || food.aisle === "meat";
  // Meat is bought by weight even though a chicken breast has a typical one.
  const counted = food.aisle !== "meat" && pieces.each && pieces.each >= MIN_PIECE_GRAMS;
  return (
    PURCHASE_UNITS.find((id) => pieces[id] && (id !== "slice" || sliced)) ??
    (counted ? "each" : null)
  );
}

function round(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * `grams` of a food in the unit a cook thinks in, not rounded up: "23" eggs,
 * "2¾ cans", "4 cups" of milk, "1½ tsp" of cumin, "450 g" of chicken.
 */
export function describeAmount(food: Food, grams: number): string {
  const unit = purchaseUnit(food);
  if (unit && food.units) return formatAmount(round(grams / food.units[unit], 0.25) || 0.25, unit);
  if (food.cup && (food.liquid || food.staple)) {
    const tsp = (grams / food.cup) * 48;
    if (tsp < 3) return formatAmount(Math.max(round(tsp, 0.25), 0.25), "tsp");
    if (tsp < 12) return formatAmount(round(tsp / 3, 0.5), "tbsp");
    return formatAmount(round(tsp / 48, 0.25), "cup");
  }
  return formatGrams(grams);
}

/** How to say `grams` of a food on a shopping list, rounded up to what a shop sells. */
export function purchaseAmount(food: Food, grams: number): { amount: string; detail: string } {
  const unit = purchaseUnit(food);
  if (unit && food.units) {
    // 3.02 onions is 3 onions; 3.2 is 4, because shops do not sell fifths.
    const count = Math.max(1, Math.ceil(grams / food.units[unit] - 0.05));
    return { amount: formatAmount(count, unit), detail: `about ${formatGrams(grams)}` };
  }
  if (food.liquid && food.cup) {
    const ml = (grams / food.cup) * CUP_ML;
    const cups = ml / CUP_ML;
    if (cups < 0.25) {
      const tbsp = Math.max(1, Math.ceil(convert(ml, "ml", "tbsp") ?? 1));
      return { amount: formatAmount(tbsp, "tbsp"), detail: `${Math.round(ml)} ml` };
    }
    const quarters = Math.ceil(cups * 4 - 0.05) / 4;
    return { amount: formatAmount(quarters, "cup"), detail: `${Math.round(ml / 5) * 5} ml` };
  }
  const rounded = grams < 100 ? Math.ceil(grams / 5) * 5 : Math.ceil(grams / 25) * 25;
  return { amount: formatGrams(rounded), detail: ounces(rounded) };
}

function timingNote(food: Food | null, lastDay: number): string | null {
  if (!food || !isPerishable(food) || food.keeps === undefined) return null;
  if (lastDay > food.keeps) {
    return `Cooked on day ${lastDay}, keeps about ${food.keeps} days: buy it later in the week or freeze it.`;
  }
  return `Keeps about ${food.keeps} days.`;
}

export function buildGroceryList(
  plan: MealPlan,
  prefs: Pick<Prefs, "servings">,
  pantry: Quantity[],
  overrides: PortionOverrides = {},
): GroceryList {
  const cookDays = new Map<string, number[]>();
  for (const event of cookEvents(plan)) {
    cookDays.set(event.recipeId, [...(cookDays.get(event.recipeId) ?? []), event.day]);
  }

  const needs = new Map<string, Need>();
  for (const recipe of plan.recipes) {
    const days = cookDays.get(recipe.id);
    if (!days || recipe.servings <= 0) continue; // A recipe no meal uses needs no shopping.
    const factor = portionsFor(plan, recipe.id, prefs, overrides) / recipe.servings;
    for (const ingredient of recipe.ingredients) {
      const resolved = resolve(ingredient);
      const food = resolved.status === "unmatched" ? null : resolved.food;
      const key = food ? food.id : `x:${normalizeName(ingredient.name) || ingredient.name}`;
      const need = needs.get(key) ?? {
        food,
        name: food ? food.name : ingredient.name,
        grams: 0,
        loose: new Map<string, number>(),
        recipes: new Set<string>(),
        firstDay: Infinity,
        lastDay: 0,
      };
      if (resolved.status === "ok") need.grams += resolved.grams * factor;
      else {
        const unit = parseUnit(ingredient.unit)?.id ?? ingredient.unit;
        need.loose.set(unit, (need.loose.get(unit) ?? 0) + ingredient.quantity * factor);
      }
      need.recipes.add(recipe.title);
      need.firstDay = Math.min(need.firstDay, ...days);
      need.lastDay = Math.max(need.lastDay, ...days);
      needs.set(key, need);
    }
  }

  const stock = new Map<string, Have>();
  for (const item of pantry) {
    const resolved = resolve(item);
    const food = resolved.status === "unmatched" ? null : resolved.food;
    const key = food ? food.id : `x:${normalizeName(item.name) || item.name}`;
    const have = stock.get(key) ?? { grams: 0, unknown: false, loose: new Map<string, number>() };
    if (resolved.status === "ok") have.grams += resolved.grams;
    else {
      have.unknown = true;
      const unit = parseUnit(item.unit)?.id ?? item.unit;
      have.loose.set(unit, (have.loose.get(unit) ?? 0) + item.quantity);
    }
    stock.set(key, have);
  }

  const list: GroceryList = { groups: [], check: [], staples: [], covered: [], buyCount: 0 };
  const buy: GroceryItem[] = [];

  for (const [key, need] of needs) {
    const { food } = need;
    const have = stock.get(key);
    const base = {
      key,
      name: need.name,
      aisle: food ? food.aisle : ("other" as const),
      perishable: food ? isPerishable(food) : false,
      keeps: food?.keeps ?? null,
      firstDay: need.firstDay,
      lastDay: need.lastDay,
      usedIn: [...need.recipes],
      needGrams: need.grams > 0 ? need.grams : null,
      haveGrams: have && have.grams > 0 ? have.grams : null,
    };
    const needText =
      food && need.grams > 0
        ? [describeAmount(food, need.grams), need.loose.size ? looseText(need.loose) : ""]
            .filter(Boolean)
            .join(" + ")
        : looseText(need.loose);

    // Staples: assume the kitchen has them unless the scan saw them (then they are covered).
    if (food?.staple) {
      const item: GroceryItem = {
        ...base,
        status: have ? "covered" : "staple",
        amount: needText,
        detail: have ? "on hand" : "pantry staple: check you have it",
        buyGrams: null,
        note: null,
      };
      (have ? list.covered : list.staples).push(item);
      continue;
    }

    // Every amount on both sides is in grams: a real subtraction.
    if (food && need.loose.size === 0 && (!have || !have.unknown)) {
      const haveGrams = have?.grams ?? 0;
      const short = need.grams - haveGrams;
      if (short <= Math.max(1, need.grams * COVERED_SLACK)) {
        list.covered.push({
          ...base,
          status: "covered",
          amount: describeAmount(food, need.grams),
          detail: `have ${describeAmount(food, haveGrams)}`,
          buyGrams: null,
          note: null,
        });
        continue;
      }
      const shown = purchaseAmount(food, short);
      buy.push({
        ...base,
        status: "buy",
        amount: shown.amount,
        detail:
          haveGrams > 0
            ? `${shown.detail}; need ${describeAmount(food, need.grams)}, have ${describeAmount(food, haveGrams)}`
            : shown.detail,
        buyGrams: short,
        note: timingNote(food, need.lastDay),
      });
      continue;
    }

    // Unknown food, same unit on both sides: subtract in that unit.
    if (!food && have && need.loose.size === 1 && have.loose.size === 1) {
      const [unit, quantity] = [...need.loose][0];
      const [haveUnit, haveQuantity] = [...have.loose][0];
      const comparable = convert(haveQuantity, haveUnit, unit);
      if (comparable !== null) {
        const short = quantity - comparable;
        const item: GroceryItem = {
          ...base,
          status: short > quantity * COVERED_SLACK ? "buy" : "covered",
          amount: formatAmount(short > 0 ? short : quantity, unit),
          detail: `need ${formatAmount(quantity, unit)}, have ${formatAmount(haveQuantity, haveUnit)}`,
          buyGrams: null,
          note: null,
        };
        (item.status === "buy" ? buy : list.covered).push(item);
        continue;
      }
    }

    // On hand, but the two amounts cannot be compared.
    if (have) {
      const haveText = [
        food && have.grams > 0 ? describeAmount(food, have.grams) : "",
        looseText(have.loose),
      ]
        .filter(Boolean)
        .join(" + ");
      list.check.push({
        ...base,
        status: "check",
        amount: needText,
        detail: `you have ${haveText}; these amounts cannot be compared, so look before you shop`,
        buyGrams: null,
        note: timingNote(food, need.lastDay),
      });
      continue;
    }

    // Nothing on hand and no gram figure: buy what the recipes ask for, as written.
    buy.push({
      ...base,
      status: "buy",
      amount: needText,
      detail: food ? "amount as written in the recipes" : "not in nutrition data",
      buyGrams: null,
      note: timingNote(food, need.lastDay),
    });
  }

  const urgency = (item: GroceryItem) => (item.perishable ? (item.keeps ?? 99) : 99);
  const order = (a: GroceryItem, b: GroceryItem) =>
    urgency(a) - urgency(b) || a.name.localeCompare(b.name);

  for (const aisle of [...AISLES, "other" as const]) {
    const items = buy.filter((item) => item.aisle === aisle).sort(order);
    if (items.length > 0) list.groups.push({ aisle, label: AISLE_LABELS[aisle], items });
  }
  list.check.sort(order);
  list.staples.sort((a, b) => a.name.localeCompare(b.name));
  list.covered.sort((a, b) => a.name.localeCompare(b.name));
  list.buyCount = buy.length;
  return list;
}

/** Plain-text version for the clipboard or a notes app. */
export function groceryText(list: GroceryList): string {
  const lines: string[] = [];
  for (const group of list.groups) {
    lines.push(group.label.toUpperCase());
    for (const item of group.items) lines.push(`- ${item.name}: ${item.amount}`);
    lines.push("");
  }
  if (list.check.length > 0) {
    lines.push("CHECK WHAT YOU HAVE");
    for (const item of list.check) lines.push(`- ${item.name}: need ${item.amount}`);
    lines.push("");
  }
  if (list.staples.length > 0) {
    lines.push("PANTRY STAPLES");
    lines.push(list.staples.map((item) => item.name).join(", "));
  }
  return lines.join("\n").trim();
}
