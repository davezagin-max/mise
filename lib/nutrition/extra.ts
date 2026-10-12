/**
 * Foods fetched from FoodData Central for this visitor.
 *
 * They are kept in localStorage (the client half of "fetch and cache"), so an
 * ingredient looked up once keeps counting toward the macros offline. They are
 * registered with the matcher, which consults them only after the bundled
 * table. Everything read from the server or from storage is validated first.
 */
import { z } from "zod";
import type { KeyValueStore } from "../session";
import type { Food } from "./foods";
import { energyBand } from "./macros";
import { normalizeName, setExtraFoods } from "./match";

export const EXTRA_KEY = "mise.fdc.v1";
const MAX_EXTRAS = 200;

const FdcFood = z.object({
  fdcId: z.number().int().positive(),
  description: z.string().min(1).max(120),
  dataType: z.string().max(40),
  kcal: z.number().min(0).max(900),
  protein: z.number().min(0).max(100),
  carbs: z.number().min(0).max(100),
  fat: z.number().min(0).max(100),
  fiber: z.number().min(0).max(100),
});
export type FdcFoodData = z.infer<typeof FdcFood>;

/** The `/api/nutrition` response. A name maps to null when FDC has no usable match. */
export const NutritionResponse = z.object({
  available: z.boolean(),
  foods: z.record(z.string().max(80), FdcFood.nullable()),
});
export type NutritionResponseData = z.infer<typeof NutritionResponse>;

const Stored = z.record(z.string().max(80), FdcFood);

/** Rejects rows whose stated energy disagrees with their own macros. */
export function plausible(food: FdcFoodData): boolean {
  if (food.protein + food.carbs + food.fat > 101 || food.fiber > food.carbs + 0.5) return false;
  const band = energyBand(food);
  return food.kcal >= band.low && food.kcal <= band.high;
}

export function toFood(food: FdcFoodData): Food {
  return {
    id: `fdc-${food.fdcId}`,
    name: food.description,
    aliases: [],
    aisle: "other",
    kcal: food.kcal,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    fiber: food.fiber,
    fdc: food.description,
    source: "fdc",
  };
}

export function createExtraStore(getStorage: () => KeyValueStore | null) {
  let foods: Record<string, FdcFoodData> | null = null;
  let version = 0;
  const listeners = new Set<() => void>();

  function publish(next: Record<string, FdcFoodData>) {
    foods = next;
    setExtraFoods(Object.entries(next).map(([name, food]) => [name, toFood(food)]));
  }

  function load(): Record<string, FdcFoodData> {
    if (foods) return foods;
    let stored: Record<string, FdcFoodData> = {};
    try {
      const parsed = Stored.safeParse(JSON.parse(getStorage()?.getItem(EXTRA_KEY) ?? "{}"));
      if (parsed.success) stored = parsed.data;
    } catch {
      // Blocked or corrupt storage: start with none.
    }
    publish(Object.fromEntries(Object.entries(stored).filter(([, food]) => plausible(food))));
    return foods ?? {};
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** A counter that changes whenever the set of extra foods does. */
    getSnapshot(): number {
      load();
      return version;
    },
    getServerSnapshot: () => 0,
    /** Adds validated lookups. Returns how many were accepted. */
    add(found: Record<string, FdcFoodData | null>): number {
      const next = { ...load() };
      let added = 0;
      for (const [name, food] of Object.entries(found)) {
        const key = normalizeName(name);
        if (!food || !key || !plausible(food) || Object.keys(next).length >= MAX_EXTRAS) continue;
        next[key] = food;
        added += 1;
      }
      if (added === 0) return 0;
      publish(next);
      version += 1;
      try {
        getStorage()?.setItem(EXTRA_KEY, JSON.stringify(next));
      } catch {
        // Keep them for this visit only.
      }
      listeners.forEach((listener) => listener());
      return added;
    },
  };
}

export const extraStore = createExtraStore(() =>
  typeof window === "undefined" ? null : window.localStorage,
);
