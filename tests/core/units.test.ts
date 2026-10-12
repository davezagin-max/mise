import { describe, expect, it } from "vitest";
import {
  CUP_ML,
  convert,
  formatAmount,
  formatGrams,
  formatNumber,
  fromGrams,
  parseUnit,
  toGrams,
} from "@/lib/units";

const grams = (quantity: number, unit: string, measures?: Parameters<typeof toGrams>[2]) => {
  const result = toGrams(quantity, unit, measures);
  if (!result.ok) throw new Error(`expected grams, got ${result.reason}`);
  return result.grams;
};

describe("parseUnit", () => {
  it("reads the spellings people actually write", () => {
    expect(parseUnit("g")?.id).toBe("g");
    expect(parseUnit("Grams")?.id).toBe("g");
    expect(parseUnit("ounces")?.id).toBe("oz");
    expect(parseUnit("lbs")?.id).toBe("lb");
    expect(parseUnit("Tbsp.")?.id).toBe("tbsp");
    expect(parseUnit("tablespoons")?.id).toBe("tbsp");
    expect(parseUnit("teaspoon")?.id).toBe("tsp");
    expect(parseUnit("fl oz")?.id).toBe("fl oz");
    expect(parseUnit("fluid ounces")?.id).toBe("fl oz");
    expect(parseUnit("cups")?.id).toBe("cup");
    expect(parseUnit("cloves")?.id).toBe("clove");
    expect(parseUnit("bunches")?.id).toBe("bunch");
    expect(parseUnit("pinches")?.id).toBe("pinch");
    expect(parseUnit("tins")?.id).toBe("can");
    expect(parseUnit("  Cans ")?.id).toBe("can");
  });

  it("treats size words and an empty unit as a plain count", () => {
    for (const text of ["", "each", "whole", "medium", "large", "pieces", "breasts"]) {
      expect(parseUnit(text)?.id).toBe("each");
    }
  });

  it("keeps mass ounces and fluid ounces apart", () => {
    expect(parseUnit("oz")?.kind).toBe("mass");
    expect(parseUnit("fl oz")?.kind).toBe("volume");
  });

  it("returns null for units it does not know", () => {
    for (const text of ["handful", "splash", "sprig", "to taste", "glug", "t"]) {
      expect(parseUnit(text)).toBeNull();
    }
  });
});

describe("toGrams: mass", () => {
  it("needs no food", () => {
    expect(grams(250, "g")).toBe(250);
    expect(grams(1.5, "kg")).toBe(1500);
    expect(grams(1, "lb")).toBeCloseTo(453.592, 2);
    expect(grams(8, "oz")).toBeCloseTo(226.796, 2);
    expect(grams(16, "oz")).toBeCloseTo(grams(1, "lb"), 6);
  });
});

describe("toGrams: volume", () => {
  const milk = { cup: 244 };
  const flour = { cup: 125 };

  it("uses the food's own density", () => {
    expect(grams(1, "cup", milk)).toBeCloseTo(244, 6);
    expect(grams(1, "cup", flour)).toBeCloseTo(125, 6);
    // The same volume of two foods weighs differently, which is the whole point.
    expect(grams(2, "cup", milk)).toBeGreaterThan(grams(2, "cup", flour) * 1.9);
  });

  it("keeps the US kitchen ratios exact", () => {
    expect(grams(16, "tbsp", milk)).toBeCloseTo(244, 6);
    expect(grams(48, "tsp", milk)).toBeCloseTo(244, 6);
    expect(grams(8, "fl oz", milk)).toBeCloseTo(244, 6);
    expect(grams(1, "pint", milk)).toBeCloseTo(488, 6);
    expect(grams(1, "quart", milk)).toBeCloseTo(976, 6);
    expect(grams(1, "gallon", milk)).toBeCloseTo(3904, 6);
    expect(grams(16, "pinch", milk)).toBeCloseTo(grams(1, "tsp", milk), 6);
    expect(grams(8, "dash", milk)).toBeCloseTo(grams(1, "tsp", milk), 6);
  });

  it("converts metric volume through the cup weight", () => {
    expect(grams(CUP_ML, "ml", milk)).toBeCloseTo(244, 6);
    expect(grams(1, "l", milk)).toBeCloseTo((1000 / CUP_ML) * 244, 6);
  });

  it("refuses to guess a density", () => {
    expect(toGrams(1, "cup")).toEqual({ ok: false, reason: "no-density" });
    expect(toGrams(1, "cup", {})).toEqual({ ok: false, reason: "no-density" });
    expect(toGrams(1, "cup", { units: { each: 50 } })).toEqual({
      ok: false,
      reason: "no-density",
    });
  });
});

describe("toGrams: count", () => {
  const garlic = { cup: 136, units: { clove: 3, head: 40 } };
  const onion = { units: { each: 110 } };

  it("uses the weight of that piece", () => {
    expect(grams(4, "cloves", garlic)).toBe(12);
    expect(grams(1, "head", garlic)).toBe(40);
    expect(grams(2, "", onion)).toBe(220);
    expect(grams(0.5, "medium", onion)).toBe(55);
  });

  it("refuses a piece the food does not define", () => {
    // Garlic has cloves and heads but no generic "each".
    expect(toGrams(2, "each", garlic)).toEqual({ ok: false, reason: "no-piece-weight" });
    expect(toGrams(1, "bunch", onion)).toEqual({ ok: false, reason: "no-piece-weight" });
    expect(toGrams(1, "can")).toEqual({ ok: false, reason: "no-piece-weight" });
  });
});

describe("toGrams: bad input", () => {
  it("reports unknown units instead of throwing", () => {
    expect(toGrams(1, "handful", { cup: 30 })).toEqual({ ok: false, reason: "unknown-unit" });
  });

  it("rejects quantities that are not positive numbers", () => {
    for (const quantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toGrams(quantity, "g")).toEqual({ ok: false, reason: "bad-quantity" });
    }
  });
});

describe("fromGrams and convert", () => {
  it("fromGrams inverts toGrams", () => {
    const spinach = { cup: 30, units: { bunch: 340 } };
    expect(fromGrams(60, "cup", spinach)).toBeCloseTo(2, 6);
    expect(fromGrams(170, "bunch", spinach)).toBeCloseTo(0.5, 6);
    expect(fromGrams(453.59237, "lb")).toBeCloseTo(1, 6);
    expect(fromGrams(100, "cup")).toBeNull();
    expect(fromGrams(100, "nonsense", spinach)).toBeNull();
  });

  it("round-trips through every kind of unit", () => {
    const food = { cup: 185, units: { each: 61 } };
    for (const unit of ["g", "oz", "lb", "cup", "tbsp", "ml", "each"]) {
      const back = fromGrams(grams(3, unit, food), unit, food);
      expect(back).toBeCloseTo(3, 9);
    }
  });

  it("converts within a kind and never across kinds", () => {
    expect(convert(1, "lb", "oz")).toBeCloseTo(16, 6);
    expect(convert(3, "tsp", "tbsp")).toBeCloseTo(1, 6);
    expect(convert(1, "cup", "ml")).toBeCloseTo(236.588, 2);
    expect(convert(2, "cloves", "clove")).toBe(2);
    expect(convert(1, "cup", "g")).toBeNull();
    expect(convert(1, "clove", "head")).toBeNull();
    expect(convert(1, "furlong", "g")).toBeNull();
  });
});

describe("formatting", () => {
  it("writes numbers the way a recipe does", () => {
    expect(formatNumber(1.5)).toBe("1½");
    expect(formatNumber(0.25)).toBe("¼");
    expect(formatNumber(2 / 3)).toBe("⅔");
    expect(formatNumber(2.3333)).toBe("2⅓");
    expect(formatNumber(3)).toBe("3");
    expect(formatNumber(2.99)).toBe("3");
    expect(formatNumber(1.45)).toBe("1.45");
    expect(formatNumber(24.4)).toBe("24");
    expect(formatNumber(0)).toBe("0");
  });

  it("labels amounts with the right unit and plural", () => {
    expect(formatAmount(200, "g")).toBe("200 g");
    expect(formatAmount(187.5, "grams")).toBe("188 g");
    expect(formatAmount(1.5, "lb")).toBe("1.5 lb");
    expect(formatAmount(1.5, "cups")).toBe("1½ cups");
    expect(formatAmount(0.5, "cup")).toBe("½ cup");
    expect(formatAmount(1, "tbsp")).toBe("1 tbsp");
    expect(formatAmount(2, "clove")).toBe("2 cloves");
    expect(formatAmount(3, "each")).toBe("3");
    expect(formatAmount(2, "handfuls")).toBe("2 handfuls");
  });

  it("rounds grams to a sensible precision", () => {
    expect(formatGrams(0.4)).toBe("<1 g");
    expect(formatGrams(42.4)).toBe("42 g");
    expect(formatGrams(437)).toBe("435 g");
    expect(formatGrams(1250)).toBe("1.25 kg");
  });
});
