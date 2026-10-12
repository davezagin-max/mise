import { describe, expect, it } from "vitest";
import { AISLES, FOODS, NUTRITION_META, foodById, isPerishable } from "@/lib/nutrition/foods";
import { energyBand } from "@/lib/nutrition/macros";
import { aliasEntries, matchFood } from "@/lib/nutrition/match";
import { parseUnit } from "@/lib/units";

describe("bundled nutrition data", () => {
  it("has the size the README claims and says where it came from", () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(250);
    expect(FOODS.length).toBeLessThanOrEqual(350);
    expect(NUTRITION_META.reference).toContain("FoodData Central");
    // Whatever state the table is in (hand-entered, or refreshed from FDC), it must say so.
    expect(NUTRITION_META.provenance.toLowerCase()).toContain("hand-entered");
    expect(typeof NUTRITION_META.verifiedAgainstFdc).toBe("boolean");
    if (!NUTRITION_META.verifiedAgainstFdc) {
      expect(NUTRITION_META.provenance).toMatch(
        /NOT pulled from the FDC API|keep their hand-entered/,
      );
    }
  });

  it("has unique ids and a valid aisle on every row", () => {
    const ids = new Set(FOODS.map((food) => food.id));
    expect(ids.size).toBe(FOODS.length);
    for (const food of FOODS) {
      expect(food.id, food.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(AISLES, food.id).toContain(food.aisle);
      expect(food.fdc.length, food.id).toBeGreaterThan(2);
    }
  });

  it("has plausible macros on every row", () => {
    for (const food of FOODS) {
      for (const key of ["kcal", "protein", "carbs", "fat", "fiber"] as const) {
        expect(Number.isFinite(food[key]) && food[key] >= 0, `${food.id}.${key}`).toBe(true);
      }
      expect(food.kcal, food.id).toBeLessThanOrEqual(900);
      expect(food.protein + food.carbs + food.fat, food.id).toBeLessThanOrEqual(100.5);
      expect(food.fiber, food.id).toBeLessThanOrEqual(food.carbs + 0.01);
    }
  });

  it("states an energy that agrees with its own macros (catches mistyped rows)", () => {
    // Vinegar's few calories come from acetic acid, which is not one of the three macros.
    const exempt = new Set(["vinegar", "apple-cider-vinegar"]);
    const off = FOODS.filter((food) => {
      const band = energyBand(food);
      return !exempt.has(food.id) && (food.kcal < band.low || food.kcal > band.high);
    }).map((food) => `${food.id}: ${food.kcal} kcal`);
    expect(off).toEqual([]);
  });

  it("uses only measures the unit module understands, with positive weights", () => {
    for (const food of FOODS) {
      if (food.cup !== undefined) expect(food.cup, food.id).toBeGreaterThan(0);
      for (const [unit, weight] of Object.entries(food.units ?? {})) {
        expect(parseUnit(unit)?.kind, `${food.id}.${unit}`).toBe("count");
        expect(parseUnit(unit)?.id, `${food.id}.${unit}`).toBe(unit);
        expect(weight, `${food.id}.${unit}`).toBeGreaterThan(0);
      }
    }
  });

  it("never lets one name point at two foods", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const { key, foodId } of aliasEntries()) {
      expect(key, foodId).not.toBe("");
      const existing = owner.get(key);
      if (existing && existing !== foodId) clashes.push(`"${key}": ${existing} and ${foodId}`);
      owner.set(key, foodId);
    }
    expect(clashes).toEqual([]);
  });

  it("resolves every food by its own display name and id", () => {
    for (const food of FOODS) {
      expect(matchFood(food.name)?.id, food.name).toBe(food.id);
      expect(foodById(food.id)).toBe(food);
    }
  });

  it("gives shelf life to fresh food and none to shelf-stable staples", () => {
    for (const food of FOODS) {
      if (food.keeps !== undefined) expect(food.keeps, food.id).toBeGreaterThan(0);
      if (food.staple) expect(isPerishable(food), food.id).toBe(false);
    }
    expect(isPerishable(foodById("chicken-breast")!)).toBe(true);
    expect(isPerishable(foodById("spinach")!)).toBe(true);
    expect(isPerishable(foodById("egg")!)).toBe(false);
    expect(isPerishable(foodById("white-rice")!)).toBe(false);
    // Raw poultry and fish are the most urgent things in a fridge.
    expect(foodById("chicken-breast")!.keeps).toBeLessThanOrEqual(2);
    expect(foodById("salmon")!.keeps).toBeLessThanOrEqual(2);
  });

  it("tags animal products so the diet check can see them", () => {
    expect(foodById("chicken-breast")!.animal).toBe("meat");
    expect(foodById("shrimp")!.animal).toBe("fish");
    expect(foodById("cheddar")!.animal).toBe("dairy");
    expect(foodById("egg")!.animal).toBe("egg");
    expect(foodById("honey")!.animal).toBe("honey");
    expect(foodById("chicken-broth")!.animal).toBe("meat");
    expect(foodById("fish-sauce")!.animal).toBe("fish");
    expect(foodById("tofu")!.animal).toBeUndefined();
    expect(foodById("almond-milk")!.animal).toBeUndefined();
    expect(foodById("peanut-butter")!.animal).toBeUndefined();
  });
});
