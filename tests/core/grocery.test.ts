import { describe, expect, it } from "vitest";
import {
  buildGroceryList,
  describeAmount,
  groceryText,
  purchaseAmount,
  type GroceryList,
} from "@/lib/grocery";
import { foodById } from "@/lib/nutrition/foods";
import type { Quantity } from "@/lib/types";
import { plan, recipe, week } from "./helpers";

const oats = recipe("oats", {
  title: "Oats",
  servings: 1,
  ingredients: [
    { name: "rolled oats", quantity: 0.5, unit: "cup", prep: "" },
    { name: "milk", quantity: 1, unit: "cup", prep: "" },
    { name: "cinnamon", quantity: 0.5, unit: "tsp", prep: "" },
  ],
});
const stir = recipe("stir", {
  title: "Chicken stir-fry",
  servings: 2,
  ingredients: [
    { name: "chicken breast", quantity: 300, unit: "g", prep: "" },
    { name: "bell pepper", quantity: 2, unit: "each", prep: "" },
    { name: "garlic", quantity: 3, unit: "cloves", prep: "" },
    { name: "soy sauce", quantity: 2, unit: "tbsp", prep: "" },
    { name: "white rice", quantity: 1, unit: "cup", prep: "" },
    { name: "black garlic paste", quantity: 1, unit: "tbsp", prep: "" },
  ],
});
const eggsOnToast = recipe("eggs", {
  title: "Eggs on toast",
  servings: 1,
  ingredients: [
    { name: "eggs", quantity: 2, unit: "each", prep: "" },
    { name: "whole wheat bread", quantity: 2, unit: "slices", prep: "" },
    { name: "spinach", quantity: 1, unit: "cup", prep: "" },
  ],
});

/** oats every breakfast (7), eggs every lunch (7), stir-fry every dinner (7). */
const weekPlan = () => plan([oats, stir, eggsOnToast], week("oats", "eggs", "stir"));

const find = (list: GroceryList, key: string) =>
  [
    ...list.groups.flatMap((group) => group.items),
    ...list.check,
    ...list.staples,
    ...list.covered,
  ].find((item) => item.key === key);

describe("needed amounts", () => {
  it("scales each recipe by people and meals, then sums per food in grams", () => {
    const list = buildGroceryList(weekPlan(), { servings: 2 }, []);
    // Stir-fry: 7 dinners x 2 people = 14 portions of a 2-serving recipe = 7 batches.
    expect(find(list, "chicken-breast")!.needGrams).toBeCloseTo(300 * 7, 6);
    expect(find(list, "bell-pepper")!.needGrams).toBeCloseTo(2 * 119 * 7, 6);
    // Oats: 14 portions of a 1-serving recipe; half a cup of oats weighs 40.5 g.
    expect(find(list, "oats")!.needGrams).toBeCloseTo(40.5 * 14, 6);
    expect(find(list, "egg")!.needGrams).toBeCloseTo(100 * 14, 6);
  });

  it("follows a portion override from a recipe card", () => {
    const base = buildGroceryList(weekPlan(), { servings: 2 }, []);
    const fewer = buildGroceryList(weekPlan(), { servings: 2 }, [], { stir: 7 });
    expect(fewer.groups).not.toEqual(base.groups);
    expect(find(fewer, "chicken-breast")!.needGrams).toBeCloseTo(300 * 3.5, 6);
    // Other recipes are untouched.
    expect(find(fewer, "egg")!.needGrams).toBeCloseTo(find(base, "egg")!.needGrams!, 6);
  });

  it("ignores recipes that no meal uses", () => {
    const p = plan([oats, stir, eggsOnToast], week("oats", "oats", "oats"));
    const list = buildGroceryList(p, { servings: 1 }, []);
    expect(find(list, "chicken-breast")).toBeUndefined();
    expect(find(list, "oats")!.needGrams).toBeCloseTo(40.5 * 21, 6);
  });
});

describe("needed minus on hand", () => {
  const pantry: Quantity[] = [
    { name: "chicken breast", quantity: 2, unit: "lb" },
    { name: "eggs", quantity: 12, unit: "each" },
    { name: "bell peppers", quantity: 3, unit: "each" },
    { name: "garlic", quantity: 1, unit: "head" },
    { name: "milk", quantity: 1, unit: "gallon" },
    { name: "spinach", quantity: 1, unit: "bag" },
    { name: "soy sauce", quantity: 1, unit: "bottle" },
  ];
  const list = buildGroceryList(weekPlan(), { servings: 1 }, pantry);

  it("subtracts in grams across different units", () => {
    // Need 7 dinners / 2 servings x 300 g = 1050 g; have 2 lb = 907 g.
    const chicken = find(list, "chicken-breast")!;
    expect(chicken.status).toBe("buy");
    expect(chicken.needGrams).toBeCloseTo(1050, 6);
    expect(chicken.haveGrams).toBeCloseTo(907.18, 1);
    expect(chicken.buyGrams).toBeCloseTo(1050 - 907.18474, 3);
    expect(chicken.amount).toBe("150 g");
    expect(chicken.detail).toBe("5.3 oz; need 1.05 kg, have 905 g");
  });

  it("marks food as covered when stock meets the need", () => {
    // 14 eggs needed, 12 on hand: buy 2. Milk: 7 cups needed, a gallon on hand.
    const eggs = find(list, "egg")!;
    expect(eggs).toMatchObject({ status: "buy", amount: "2" });
    expect(eggs.buyGrams).toBeCloseTo(100, 6);
    expect(find(list, "milk-2")).toMatchObject({ status: "covered" });
    // 7 batches / 2 x 3 cloves x 3 g = 31.5 g; one head is 40 g.
    expect(find(list, "garlic")).toMatchObject({
      status: "covered",
      amount: "¾ head",
      detail: "have 1 head",
    });
    expect(find(list, "milk-2")).toMatchObject({ amount: "7 cups", detail: "have 16 cups" });
    expect(list.covered.map((item) => item.key)).toContain("garlic");
  });

  it("buys only the shortfall, rounded up to whole things", () => {
    // Need 7 peppers (3.5 batches x 2), have 3: buy 4.
    const peppers = find(list, "bell-pepper")!;
    expect(peppers.status).toBe("buy");
    expect(peppers.amount).toBe("4");
    expect(peppers.buyGrams).toBeCloseTo(4 * 119, 6);
  });

  it("says 'check' when stock is in a unit that cannot be compared", () => {
    const spinach = find(list, "spinach")!;
    expect(spinach.status).toBe("check");
    expect(spinach.detail).toContain("you have 1 package");
    expect(list.check.map((item) => item.key)).toEqual(["spinach"]);
  });

  it("treats staples as assumed, and as covered once the scan saw them", () => {
    expect(find(list, "soy-sauce")!.status).toBe("covered");
    expect(find(list, "cinnamon")!.status).toBe("staple");
    expect(list.staples.map((item) => item.key)).toEqual(["cinnamon"]);
    const bare = buildGroceryList(weekPlan(), { servings: 1 }, []);
    expect(bare.staples.map((item) => item.key).sort()).toEqual(["cinnamon", "soy-sauce"]);
  });

  it("puts unknown ingredients on the list as written", () => {
    const paste = find(list, "x:black garlic paste")!;
    expect(paste).toMatchObject({
      status: "buy",
      aisle: "other",
      amount: "3½ tbsp",
      detail: "not in nutrition data",
    });
    const withStock = buildGroceryList(weekPlan(), { servings: 1 }, [
      { name: "Black garlic paste", quantity: 0.25, unit: "cup" },
    ]);
    // A quarter cup is 4 tbsp, more than the 3.5 needed.
    expect(find(withStock, "x:black garlic paste")!.status).toBe("covered");
  });
});

describe("ordering and notes", () => {
  it("groups by aisle in shop order with the most perishable first", () => {
    const list = buildGroceryList(weekPlan(), { servings: 2 }, []);
    expect(list.groups.map((group) => group.aisle)).toEqual([
      "produce",
      "meat",
      "chilled",
      "bakery",
      "grains",
      "other",
    ]);
    const produce = list.groups[0].items.map((item) => item.key);
    // Spinach keeps 5 days, peppers 7, garlic 30.
    expect(produce).toEqual(["spinach", "bell-pepper", "garlic"]);
    expect(list.buyCount).toBe(list.groups.reduce((n, group) => n + group.items.length, 0));
  });

  it("warns when something will not keep until the day it is cooked", () => {
    const late = plan([oats, stir, eggsOnToast], [
      ["oats", "eggs", "eggs"],
      ["oats", "eggs", "eggs"],
      ["oats", "eggs", "eggs"],
      ["oats", "eggs", "eggs"],
      ["oats", "eggs", "stir"],
      ["oats", "stir", "eggs"],
      ["oats", "eggs", "eggs"],
    ]);
    const list = buildGroceryList(late, { servings: 2 }, []);
    const chicken = find(list, "chicken-breast")!;
    expect(chicken).toMatchObject({ perishable: true, keeps: 2, firstDay: 5, lastDay: 5 });
    expect(chicken.note).toBe(
      "Cooked on day 5, keeps about 2 days: buy it later in the week or freeze it.",
    );
    // Eggs keep four weeks: no note. Spinach is cooked from day 1 but again on day 5.
    expect(find(list, "egg")!.note).toBeNull();
    expect(find(list, "spinach")!.note).toContain("Keeps about 5 days");
  });

  it("writes a plain-text list", () => {
    const text = groceryText(buildGroceryList(weekPlan(), { servings: 1 }, []));
    expect(text).toContain("PRODUCE\n- Spinach: 225 g");
    expect(text).toContain("- Eggs: 14");
    expect(text).toContain("PANTRY STAPLES\nGround cinnamon, Soy sauce");
  });
});

describe("purchaseAmount", () => {
  const amount = (id: string, grams: number) => purchaseAmount(foodById(id)!, grams);

  it("counts things sold by the piece and rounds up", () => {
    expect(amount("onion", 330)).toEqual({ amount: "3", detail: "about 330 g" });
    expect(amount("onion", 340).amount).toBe("4");
    expect(amount("onion", 20).amount).toBe("1");
    expect(amount("chickpeas", 400).amount).toBe("2 cans");
    expect(amount("garlic", 12).amount).toBe("1 head");
    expect(amount("salmon", 340).amount).toBe("2 fillets");
    expect(amount("bread-whole-wheat", 64).amount).toBe("2 slices");
  });

  it("weighs small or loose things instead of counting them", () => {
    expect(amount("cherry-tomatoes", 300)).toEqual({ amount: "300 g", detail: "11 oz" });
    expect(amount("cheddar", 113).amount).toBe("125 g");
    expect(amount("ground-beef", 500)).toEqual({ amount: "500 g", detail: "1.1 lb" });
    expect(amount("feta", 60).amount).toBe("1 block");
  });

  it("describes an amount in the unit a cook thinks in", () => {
    const say = (id: string, grams: number) => describeAmount(foodById(id)!, grams);
    expect(say("egg", 1150)).toBe("23");
    expect(say("chickpeas", 375)).toBe("1½ cans");
    expect(say("milk-2", 976)).toBe("4 cups");
    expect(say("olive-oil", 27)).toBe("2 tbsp");
    expect(say("cumin", 4.2)).toBe("2 tsp");
    expect(say("chicken-breast", 680)).toBe("680 g");
    expect(say("cherry-tomatoes", 280)).toBe("280 g");
  });

  it("measures liquids by volume", () => {
    expect(amount("milk-2", 488)).toEqual({ amount: "2 cups", detail: "475 ml" });
    expect(amount("milk-2", 300).amount).toBe("1¼ cups");
    expect(amount("coconut-milk", 400).amount).toBe("1 can");
    expect(amount("heavy-cream", 30)).toEqual({ amount: "3 tbsp", detail: "30 ml" });
  });
});
