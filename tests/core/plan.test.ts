import { describe, expect, it } from "vitest";
import { checkPlan, needsRevision, pantryFoods } from "@/lib/plan/check";
import { cookEvents, describeEvents, mealCount, portionsFor } from "@/lib/plan/schedule";
import { recipeNutrition } from "@/lib/nutrition/macros";
import { plan, prefs, recipe, week } from "./helpers";

const oats = recipe("oats", {
  title: "Oats",
  servings: 1,
  ingredients: [
    { name: "rolled oats", quantity: 60, unit: "g", prep: "" },
    { name: "greek yogurt", quantity: 200, unit: "g", prep: "" },
  ],
});
const chicken = recipe("chicken", {
  title: "Chicken and rice",
  minutes: 25,
  servings: 2,
  ingredients: [
    { name: "chicken breast", quantity: 400, unit: "g", prep: "" },
    { name: "white rice", quantity: 150, unit: "g", prep: "" },
    { name: "spinach", quantity: 4, unit: "cup", prep: "" },
  ],
});
const salad = recipe("salad", {
  title: "Chickpea salad",
  minutes: 10,
  servings: 2,
  ingredients: [
    { name: "chickpeas", quantity: 1, unit: "can", prep: "drained" },
    { name: "cucumber", quantity: 1, unit: "each", prep: "" },
    { name: "feta", quantity: 100, unit: "g", prep: "" },
  ],
});

const good = () => plan([oats, chicken, salad], week("oats", "salad", "chicken"));

describe("cookEvents", () => {
  it("treats repeats within three days as leftovers and later ones as a new cook", () => {
    const p = plan([oats, chicken, salad], [
      ["oats", "salad", "chicken"],
      ["oats", "chicken", "salad"],
      ["oats", "salad", "salad"],
      ["oats", "salad", "chicken"],
      ["oats", "chicken", "salad"],
      ["oats", "salad", "salad"],
      ["oats", "salad", "chicken"],
    ]);
    const events = cookEvents(p).filter((event) => event.recipeId === "chicken");
    // Days 1, 2, 4 share one cook (4 - 1 = 3). Day 5 is four days out: a second cook.
    expect(events.map((event) => event.day)).toEqual([1, 5]);
    expect(events[0].meals).toEqual([
      { day: 1, slot: "dinner" },
      { day: 2, slot: "lunch" },
      { day: 4, slot: "dinner" },
    ]);
    expect(events[1].meals.map((meal) => meal.day)).toEqual([5, 7]);
  });

  it("orders a same-day lunch before dinner and counts meals", () => {
    const p = plan([oats, chicken], week("oats", "chicken", "chicken"));
    const first = cookEvents(p).find((event) => event.recipeId === "chicken")!;
    expect(first.meals.slice(0, 2)).toEqual([
      { day: 1, slot: "lunch" },
      { day: 1, slot: "dinner" },
    ]);
    expect(mealCount(p, "chicken")).toBe(14);
    expect(mealCount(p, "nope")).toBe(0);
  });

  it("makes a quick recipe fresh for every meal instead of treating it as leftovers", () => {
    const quick = recipe("toast", { minutes: 10 });
    const p = plan([quick, chicken], week("toast", "chicken", "chicken"));
    const toast = cookEvents(p).filter((event) => event.recipeId === "toast");
    expect(toast.map((event) => event.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(toast.every((event) => event.meals.length === 1)).toBe(true);
    // Fifteen minutes is the cut-off; sixteen is batch cooking.
    const edge = plan(
      [recipe("a", { minutes: 15 }), recipe("b", { minutes: 16 })],
      week("a", "b", "b"),
    );
    expect(cookEvents(edge).filter((event) => event.recipeId === "a")).toHaveLength(7);
    expect(
      cookEvents(edge)
        .filter((event) => event.recipeId === "b")
        .map((event) => event.day),
    ).toEqual([1, 5]);
  });

  it("describes cook days in one line", () => {
    const p = plan([oats, chicken, salad], [
      ["oats", "salad", "chicken"],
      ["oats", "chicken", "salad"],
      ["oats", "salad", "salad"],
      ["oats", "salad", "salad"],
      ["oats", "salad", "salad"],
      ["oats", "salad", "chicken"],
      ["oats", "salad", "salad"],
    ]);
    const of = (id: string) => cookEvents(p).filter((event) => event.recipeId === id);
    expect(describeEvents(of("chicken"))).toBe("Cook on day 1, eat through day 2. Cook on day 6");
    // The salad takes 10 minutes, so it is made on each of its days.
    expect(describeEvents(of("salad"))).toBe("Made fresh on days 1, 2, 3, 4, 5, 6 and 7");
    expect(describeEvents([])).toBe("");
  });

  it("makes one portion per person per meal unless overridden", () => {
    const p = good();
    expect(portionsFor(p, "chicken", { servings: 2 })).toBe(14);
    expect(portionsFor(p, "chicken", { servings: 3 })).toBe(21);
    expect(portionsFor(p, "chicken", { servings: 2 }, { chicken: 6 })).toBe(6);
    expect(portionsFor(p, "chicken", { servings: 2 }, { chicken: 0 })).toBe(14);
  });
});

describe("checkPlan: structure", () => {
  it("accepts a well-formed plan", () => {
    const report = checkPlan(good(), prefs(), []);
    expect(report.errors).toEqual([]);
    expect(report.days).toHaveLength(7);
  });

  it("rejects the wrong number of days, a missing meal and a dangling recipe id", () => {
    const short = good();
    short.days.pop();
    expect(checkPlan(short, prefs(), []).errors[0].message).toContain("exactly 7 days");

    const noLunch = good();
    noLunch.days[2].meals = noLunch.days[2].meals.filter((meal) => meal.slot !== "lunch");
    expect(checkPlan(noLunch, prefs(), []).errors[0]).toMatchObject({ code: "structure", day: 3 });

    const dangling = good();
    dangling.days[0].meals[0].recipeId = "ghost";
    expect(checkPlan(dangling, prefs(), []).errors[0].message).toContain("does not exist");

    const twice = good();
    twice.days[4].day = 4;
    expect(checkPlan(twice, prefs(), []).errors.length).toBeGreaterThan(0);
  });

  it("rejects duplicate ids, empty recipes and bad quantities, and skips the maths", () => {
    const bad = plan(
      [
        oats,
        { ...chicken, id: "oats" },
        recipe("empty", { ingredients: [], steps: [] }),
        recipe("neg", { ingredients: [{ name: "salt", quantity: -1, unit: "tsp", prep: "" }] }),
      ],
      week("oats", "empty", "neg"),
    );
    const report = checkPlan(bad, prefs(), []);
    const text = report.errors.map((issue) => issue.message).join("\n");
    expect(text).toContain('"oats" is used twice');
    expect(text).toContain("has no ingredients");
    expect(text).toContain("has no steps");
    expect(text).toContain("salt has an invalid quantity");
    expect(report.days).toEqual([]);
  });
});

describe("checkPlan: diet and time", () => {
  it("flags a recipe over the cook-time limit", () => {
    const report = checkPlan(good(), prefs({ maxMinutes: 20 }), []);
    expect(report.errors).toEqual([
      expect.objectContaining({ code: "over-time", recipeId: "chicken" }),
    ]);
  });

  it("enforces each diet from the food data, not from the recipe's wording", () => {
    const codes = (diet: Parameters<typeof prefs>[0]) =>
      checkPlan(good(), prefs(diet), []).errors.map((issue) => `${issue.code}:${issue.recipeId}`);
    expect(codes({ diet: "omnivore" })).toEqual([]);
    expect(codes({ diet: "pescatarian" })).toEqual(["diet:chicken"]);
    expect(codes({ diet: "vegetarian" })).toEqual(["diet:chicken"]);
    // Vegan also rules out the yogurt in the oats and the feta in the salad.
    expect(codes({ diet: "vegan" }).sort()).toEqual(["diet:chicken", "diet:oats", "diet:salad"]);
  });

  it("lets fish through for pescatarians and stops it for vegetarians", () => {
    const fish = recipe("fish", {
      ingredients: [{ name: "salmon", quantity: 2, unit: "fillet", prep: "" }],
    });
    const p = plan([fish], week("fish", "fish", "fish"));
    expect(checkPlan(p, prefs({ diet: "pescatarian" }), []).errors).toEqual([]);
    expect(checkPlan(p, prefs({ diet: "vegetarian" }), []).errors[0].code).toBe("diet");
  });

  it("warns, without failing, about an unknown ingredient that sounds off-diet", () => {
    const duck = recipe("duck", {
      ingredients: [
        { name: "duck breast", quantity: 300, unit: "g", prep: "" },
        { name: "oat milk", quantity: 1, unit: "cup", prep: "" },
        { name: "eggplant", quantity: 1, unit: "each", prep: "" },
      ],
    });
    const p = plan([duck], week("duck", "duck", "duck"));
    const veg = checkPlan(p, prefs({ diet: "vegetarian" }), []);
    expect(veg.errors).toEqual([]);
    expect(veg.warnings.filter((issue) => issue.code === "diet-unverified")).toHaveLength(1);
    expect(veg.warnings[0].message).toContain("duck breast");
    // "egg" must not fire on "eggplant", which the data knows is a vegetable.
    const vegan = checkPlan(p, prefs({ diet: "vegan" }), []);
    const flagged = vegan.warnings
      .filter((issue) => issue.code === "diet-unverified")
      .map((issue) => issue.message);
    expect(flagged).toHaveLength(2);
    expect(flagged.join(" ")).not.toContain("eggplant");
  });
});

describe("checkPlan: protein and coverage", () => {
  it("computes each day's protein from the recipes and compares it with the target", () => {
    const perDay =
      recipeNutrition(oats).perServing.protein +
      recipeNutrition(chicken).perServing.protein +
      recipeNutrition(salad).perServing.protein;
    const report = checkPlan(good(), prefs({ proteinTarget: 80 }), []);
    expect(report.days[0].macros.protein).toBeCloseTo(perDay, 6);
    expect(perDay).toBeGreaterThan(80);
    expect(report.days.every((day) => day.proteinOk)).toBe(true);

    const hard = checkPlan(good(), prefs({ proteinTarget: 200 }), []);
    expect(hard.days.every((day) => !day.proteinOk)).toBe(true);
    const short = hard.warnings.filter((issue) => issue.code === "protein-short");
    expect(short).toHaveLength(7);
    expect(short[0].message).toContain(`${Math.round(perDay)} g`);
    expect(short[0].message).toContain("200 g");
  });

  it("counts a day as on target at 90% of the goal, not below", () => {
    const perDay = checkPlan(good(), prefs(), []).days[0].macros.protein;
    const at = (target: number) =>
      checkPlan(good(), prefs({ proteinTarget: target }), []).days[0].proteinOk;
    expect(at(perDay / 0.9 - 0.5)).toBe(true);
    expect(at(perDay / 0.9 + 0.5)).toBe(false);
  });

  it("reports ingredients left out of the totals and warns when too many are", () => {
    const mystery = recipe("mystery", {
      ingredients: [
        { name: "moon cheese", quantity: 1, unit: "cup", prep: "" },
        { name: "unobtainium", quantity: 2, unit: "tbsp", prep: "" },
        { name: "white rice", quantity: 100, unit: "g", prep: "" },
      ],
    });
    const report = checkPlan(plan([mystery], week("mystery", "mystery", "mystery")), prefs(), []);
    expect(report.coverage).toEqual({
      counted: 1,
      total: 3,
      missing: ["moon cheese", "unobtainium"],
    });
    expect(report.warnings.some((issue) => issue.code === "low-coverage")).toBe(true);
    expect(checkPlan(good(), prefs(), []).warnings.some((i) => i.code === "low-coverage")).toBe(
      false,
    );
  });
});

describe("checkPlan: perishables", () => {
  const pantry = [
    { name: "chicken breast", quantity: 2, unit: "each" },
    { name: "spinach", quantity: 1, unit: "bag" },
    { name: "raspberries", quantity: 1, unit: "cup" },
    { name: "eggs", quantity: 6, unit: "each" },
    { name: "mystery jar", quantity: 1, unit: "jar" },
  ];

  it("lists on-hand perishables most urgent first and marks each one", () => {
    const report = checkPlan(good(), prefs(), pantry);
    expect(report.perishables).toEqual([
      { foodId: "chicken-breast", name: "Chicken breast", keeps: 2, firstDay: 1, status: "ok" },
      { foodId: "raspberries", name: "Raspberries", keeps: 3, firstDay: null, status: "unused" },
      { foodId: "spinach", name: "Spinach", keeps: 5, firstDay: 1, status: "ok" },
    ]);
    // Eggs keep four weeks, so they are not on the urgent list; the unknown jar is ignored.
    expect(report.pantry).toEqual({ used: 2, total: 4 });
    expect(pantryFoods(pantry).map((food) => food.id)).toEqual([
      "chicken-breast",
      "spinach",
      "raspberries",
      "egg",
    ]);
  });

  it("warns when a perishable is first cooked after it would have spoiled", () => {
    const late = plan([oats, chicken, salad], [
      ["oats", "salad", "salad"],
      ["oats", "salad", "salad"],
      ["oats", "salad", "chicken"],
      ["oats", "chicken", "salad"],
      ["oats", "salad", "salad"],
      ["oats", "salad", "salad"],
      ["oats", "salad", "salad"],
    ]);
    const report = checkPlan(late, prefs(), pantry);
    const chickenUse = report.perishables.find((use) => use.foodId === "chicken-breast")!;
    expect(chickenUse).toMatchObject({ firstDay: 3, status: "late" });
    // Spinach keeps five days, so day 3 is fine.
    expect(report.perishables.find((use) => use.foodId === "spinach")!.status).toBe("ok");
    const warning = report.warnings.find((issue) => issue.code === "late-perishable")!;
    expect(warning.message).toBe("Chicken breast keeps about 2 days but is first cooked on day 3.");
  });

  it("asks for a revision on errors, protein gaps and late perishables only", () => {
    const fine = checkPlan(good(), prefs(), pantry);
    // The unused raspberries are advice, not a reason to redo the plan.
    expect(fine.warnings.map((issue) => issue.code)).toEqual(["unused-perishable"]);
    expect(needsRevision(fine)).toEqual([]);

    const short = checkPlan(good(), prefs({ proteinTarget: 200, maxMinutes: 20 }), pantry);
    const codes = new Set(needsRevision(short).map((issue) => issue.code));
    expect(codes).toEqual(new Set(["over-time", "protein-short"]));
  });
});
