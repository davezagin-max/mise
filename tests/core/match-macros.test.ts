import { describe, expect, it } from "vitest";
import {
  dayMacros,
  macrosForGrams,
  recipeNutrition,
  resolve,
  scaleRecipe,
} from "@/lib/nutrition/macros";
import { foodById } from "@/lib/nutrition/foods";
import { matchFood, normalizeName } from "@/lib/nutrition/match";
import type { MealPlan, Recipe } from "@/lib/types";

describe("normalizeName", () => {
  it("drops case, punctuation, plurals and preparation words", () => {
    expect(normalizeName("Tomatoes, diced")).toBe("tomato");
    expect(normalizeName("Boneless, skinless chicken breasts")).toBe("chicken breast");
    expect(normalizeName("  Extra-Virgin Olive Oil ")).toBe("olive oil");
    expect(normalizeName("low-sodium soy sauce")).toBe("soy sauce");
    expect(normalizeName("Jalapeño")).toBe("jalapeno");
    expect(normalizeName("Greek yogurt (nonfat, plain)")).toBe("greek yogurt");
    expect(normalizeName("berries")).toBe("berry");
    expect(normalizeName("radishes")).toBe("radish");
  });

  it("leaves words that change which food it is", () => {
    expect(normalizeName("cooked rice")).toBe("cooked rice");
    expect(normalizeName("ground beef")).toBe("ground beef");
    expect(normalizeName("frozen spinach")).toBe("frozen spinach");
    expect(normalizeName("whole milk")).toBe("whole milk");
    expect(normalizeName("hummus")).toBe("hummus");
    expect(normalizeName("asparagus")).toBe("asparagus");
  });
});

describe("matchFood", () => {
  const id = (name: string) => matchFood(name)?.id ?? null;

  it("finds foods by name, alias, plural and preparation", () => {
    expect(id("chicken breast")).toBe("chicken-breast");
    expect(id("Boneless skinless chicken breasts")).toBe("chicken-breast");
    expect(id("scallions")).toBe("green-onion");
    expect(id("garbanzo beans")).toBe("chickpeas");
    expect(id("Eggs")).toBe("egg");
    expect(id("large eggs")).toBe("egg");
    expect(id("baby spinach")).toBe("spinach");
    expect(id("2% milk")).toBe("milk-2");
    expect(id("extra virgin olive oil")).toBe("olive-oil");
    expect(id("cherry tomatoes, halved")).toBe("cherry-tomatoes");
    expect(id("chicken breast, cut into strips")).toBe("chicken-breast");
  });

  it("keeps look-alikes apart", () => {
    expect(id("almond butter")).toBe("almond-butter");
    expect(id("peanut butter")).toBe("peanut-butter");
    expect(id("butter")).toBe("butter");
    expect(id("coconut milk")).toBe("coconut-milk");
    expect(id("almond milk")).toBe("almond-milk");
    expect(id("whole milk")).toBe("milk-whole");
    expect(id("rice")).toBe("white-rice");
    expect(id("cooked rice")).toBe("cooked-white-rice");
    expect(id("sweet potato")).toBe("sweet-potato");
    expect(id("potato")).toBe("potato");
    expect(id("red pepper flakes")).toBe("red-pepper-flakes");
    expect(id("red bell pepper")).toBe("bell-pepper");
    expect(id("black pepper")).toBe("black-pepper");
    expect(id("spinach")).toBe("spinach");
    expect(id("frozen spinach")).toBe("frozen-spinach");
  });

  it("treats 'fresh' as part of the name only when it has to be", () => {
    expect(id("thyme")).toBe("thyme");
    expect(id("fresh thyme")).toBe("fresh-thyme");
    expect(id("chopped fresh thyme")).toBe("fresh-thyme");
    expect(id("mozzarella")).toBe("mozzarella");
    expect(id("fresh mozzarella")).toBe("fresh-mozzarella");
    expect(id("fresh spinach")).toBe("spinach");
    expect(id("fresh strawberries")).toBe("strawberries");
    expect(id("ginger")).toBe("ginger");
    expect(id("ground ginger")).toBe("ground-ginger");
  });

  it("returns null instead of guessing", () => {
    for (const name of ["cashew butter", "oat milk", "dragon fruit", "duck breast", "", "   "]) {
      expect(matchFood(name), name).toBeNull();
    }
  });
});

describe("macros", () => {
  it("scales a food's per-100g figures by weight", () => {
    const chicken = foodById("chicken-breast")!;
    const m = macrosForGrams(chicken, 200);
    expect(m.kcal).toBeCloseTo(240, 6);
    expect(m.protein).toBeCloseTo(45, 6);
    expect(m.fat).toBeCloseTo(5.2, 6);
    expect(m.carbs).toBe(0);
  });

  it("resolves an ingredient through match, then grams, then macros", () => {
    const eggs = resolve({ name: "eggs", quantity: 3, unit: "each" });
    expect(eggs.status).toBe("ok");
    if (eggs.status !== "ok") return;
    expect(eggs.grams).toBe(150);
    expect(eggs.macros.protein).toBeCloseTo(18.9, 6);
    expect(eggs.macros.kcal).toBeCloseTo(214.5, 6);

    const rice = resolve({ name: "white rice", quantity: 1, unit: "cup" });
    expect(rice.status === "ok" && rice.grams).toBeCloseTo(185, 6);
    expect(rice.status === "ok" && rice.macros.carbs).toBeCloseTo(148, 6);
  });

  it("says why an ingredient could not be counted", () => {
    expect(resolve({ name: "oat milk", quantity: 1, unit: "cup" })).toEqual({
      status: "unmatched",
    });
    const pasta = resolve({ name: "pasta", quantity: 2, unit: "cups" });
    expect(pasta.status === "unconvertible" && pasta.reason).toBe("no-density");
    const garlic = resolve({ name: "garlic", quantity: 2, unit: "each" });
    expect(garlic.status === "unconvertible" && garlic.reason).toBe("no-piece-weight");
    const basil = resolve({ name: "fresh basil", quantity: 1, unit: "handful" });
    expect(basil.status === "unconvertible" && basil.reason).toBe("unknown-unit");
  });
});

const bowl: Recipe = {
  id: "bowl",
  title: "Chicken rice bowl",
  minutes: 25,
  servings: 2,
  ingredients: [
    { name: "chicken breast", quantity: 300, unit: "g", prep: "sliced" },
    { name: "white rice", quantity: 150, unit: "g", prep: "" },
    { name: "broccoli", quantity: 2, unit: "cup", prep: "florets" },
    { name: "olive oil", quantity: 1, unit: "tbsp", prep: "" },
    { name: "furikake", quantity: 1, unit: "tsp", prep: "" },
  ],
  steps: ["Cook the rice.", "Sear the chicken.", "Steam the broccoli."],
  why: "Uses the chicken first.",
};

describe("recipeNutrition", () => {
  it("sums what it can and names what it left out", () => {
    const n = recipeNutrition(bowl);
    // 300 g chicken + 150 g rice + 182 g broccoli + 13.5 g oil, from the bundled table.
    const expected = {
      kcal: 3 * 120 + 1.5 * 365 + 1.82 * 34 + 0.135 * 884,
      protein: 3 * 22.5 + 1.5 * 7.1 + 1.82 * 2.8,
      fat: 3 * 2.6 + 1.5 * 0.7 + 1.82 * 0.4 + 13.5,
    };
    expect(n.total.kcal).toBeCloseTo(expected.kcal, 4);
    expect(n.total.protein).toBeCloseTo(expected.protein, 4);
    expect(n.total.fat).toBeCloseTo(expected.fat, 4);
    expect(n.perServing.kcal).toBeCloseTo(expected.kcal / 2, 4);
    expect(n.counted).toBe(4);
    expect(n.missing).toEqual(["furikake"]);
    expect(n.lines.map((line) => line.status)).toEqual(["ok", "ok", "ok", "ok", "unmatched"]);
  });

  it("serving scaling changes quantities and totals but not a serving", () => {
    const doubled = scaleRecipe(bowl, 4);
    expect(doubled.servings).toBe(4);
    expect(doubled.ingredients[0].quantity).toBe(600);
    expect(doubled.ingredients[2].quantity).toBe(4);
    const before = recipeNutrition(bowl);
    const after = recipeNutrition(doubled);
    expect(after.total.kcal).toBeCloseTo(before.total.kcal * 2, 6);
    expect(after.perServing.protein).toBeCloseTo(before.perServing.protein, 6);

    const half = scaleRecipe(bowl, 1);
    expect(half.ingredients[1].quantity).toBe(75);
    expect(recipeNutrition(half).perServing.kcal).toBeCloseTo(before.perServing.kcal, 6);
    // Nonsense portions leave the recipe alone.
    expect(scaleRecipe(bowl, 0)).toBe(bowl);
    expect(scaleRecipe(bowl, Number.NaN)).toBe(bowl);
  });

  it("adds one serving of each meal for a day", () => {
    const plan: MealPlan = {
      title: "t",
      summary: "",
      recipes: [bowl],
      days: [
        {
          day: 1,
          meals: [
            { slot: "lunch", recipeId: "bowl" },
            { slot: "dinner", recipeId: "bowl" },
          ],
        },
      ],
    };
    const serving = recipeNutrition(bowl).perServing;
    expect(dayMacros(plan, 1).protein).toBeCloseTo(serving.protein * 2, 6);
    expect(dayMacros(plan, 2).kcal).toBe(0);
  });
});
