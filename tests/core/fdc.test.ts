import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/nutrition/route";
import {
  EXTRA_KEY,
  createExtraStore,
  plausible,
  type FdcFoodData,
} from "@/lib/nutrition/extra";
import { createCache, lookupFdc, macrosFromFdc, searchFdc } from "@/lib/nutrition/fdc.mjs";
import { resolve } from "@/lib/nutrition/macros";
import { matchFood, setExtraFoods } from "@/lib/nutrition/match";
import { checkPlan } from "@/lib/plan/check";
import type { KeyValueStore } from "@/lib/session";
import { plan, prefs, recipe, week } from "./helpers";

/**
 * A search result in the shape the FoodData Central API guide documents.
 * Hand-built for the test: not a recorded response.
 */
const duck = {
  fdcId: 990001,
  description: "Duck, meat only, raw (test row)",
  dataType: "SR Legacy",
  foodNutrients: [
    { nutrientId: 1003, nutrientNumber: "203", unitName: "G", value: 18.28 },
    { nutrientId: 1004, nutrientNumber: "204", unitName: "G", value: 5.95 },
    { nutrientId: 1005, nutrientNumber: "205", unitName: "G", value: 0 },
    { nutrientId: 1062, nutrientNumber: "268", unitName: "kJ", value: 565 },
    { nutrientId: 1008, nutrientNumber: "208", unitName: "KCAL", value: 135 },
  ],
};
const duckFood: FdcFoodData = {
  fdcId: 990001,
  description: "Duck, meat only, raw (test row)",
  dataType: "SR Legacy",
  kcal: 135,
  protein: 18.3,
  carbs: 0,
  fat: 6,
  fiber: 0,
};

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  setExtraFoods([]);
  vi.unstubAllGlobals();
  delete process.env.USDA_API_KEY;
});

describe("macrosFromFdc", () => {
  it("reads per-100g macros by nutrient id, taking kcal and not kJ for energy", () => {
    expect(macrosFromFdc(duck)).toEqual({ kcal: 135, protein: 18.3, carbs: 0, fat: 6, fiber: 0 });
  });

  it("also accepts the older nutrient numbers", () => {
    const byNumber = {
      foodNutrients: [
        { nutrientNumber: "208", unitName: "KCAL", value: 52 },
        { nutrientNumber: "203", unitName: "G", value: 0.26 },
        { nutrientNumber: "204", unitName: "G", value: 0.17 },
        { nutrientNumber: "205", unitName: "G", value: 13.81 },
        { nutrientNumber: "291", unitName: "G", value: 2.4 },
      ],
    };
    expect(macrosFromFdc(byNumber)).toEqual({
      kcal: 52,
      protein: 0.3,
      carbs: 13.8,
      fat: 0.2,
      fiber: 2.4,
    });
  });

  it("refuses rows that are incomplete or impossible", () => {
    const without = (id: number) => ({
      foodNutrients: duck.foodNutrients.filter((n) => n.nutrientId !== id),
    });
    expect(macrosFromFdc(without(1008))).toBeNull();
    expect(macrosFromFdc(without(1003))).toBeNull();
    expect(macrosFromFdc({ foodNutrients: "nope" })).toBeNull();
    expect(macrosFromFdc(null)).toBeNull();
    const absurd = {
      foodNutrients: [
        { nutrientId: 1008, unitName: "KCAL", value: 100 },
        { nutrientId: 1003, unitName: "G", value: 80 },
        { nutrientId: 1004, unitName: "G", value: 80 },
        { nutrientId: 1005, unitName: "G", value: 80 },
      ],
    };
    expect(macrosFromFdc(absurd)).toBeNull();
  });
});

describe("searchFdc", () => {
  it("sends the key in a header, never in the URL, and returns the first usable row", async () => {
    const fetchMock = vi.fn<(url: URL | RequestInfo, init?: RequestInit) => Promise<Response>>(
      async () => ok({ foods: [{ fdcId: 1, description: "junk", foodNutrients: [] }, duck] }),
    );
    const found = await searchFdc("duck breast", { apiKey: "test-usda-key", fetch: fetchMock });
    expect(found).toEqual(duckFood);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("query=duck+breast");
    expect(String(url)).not.toContain("test-usda-key");
    expect(new Headers(init?.headers).get("x-api-key")).toBe("test-usda-key");
  });

  it("returns null when nothing usable comes back and throws on an HTTP error", async () => {
    const empty = vi.fn(async () => ok({ foods: [] }));
    expect(await searchFdc("x", { apiKey: "k", fetch: empty })).toBeNull();
    const down = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(searchFdc("x", { apiKey: "k", fetch: down })).rejects.toThrow("HTTP 503");
  });
});

describe("cache", () => {
  it("expires entries and evicts the oldest when full", () => {
    let now = 0;
    const cache = createCache<number>({ ttlMs: 100, max: 2, now: () => now });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toEqual({ value: 1 });
    cache.set("c", 3);
    expect(cache.get("a")).toBeNull();
    expect(cache.size).toBe(2);
    now = 101;
    expect(cache.get("b")).toBeNull();
  });

  it("asks FoodData Central once per name, hit or miss, and retries after an error", async () => {
    const cache = createCache<FdcFoodData | null>();
    const fetchMock = vi.fn(async (url: URL | RequestInfo) =>
      ok({ foods: String(url).includes("duck") ? [duck] : [] }),
    );
    const options = { apiKey: "k", fetch: fetchMock, cache };
    expect(await lookupFdc("Duck Breast", options)).toEqual(duckFood);
    expect(await lookupFdc("  duck breast ", options)).toEqual(duckFood);
    expect(await lookupFdc("unobtainium", options)).toBeNull();
    expect(await lookupFdc("unobtainium", options)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(ok({ foods: [duck] }));
    const fresh = { apiKey: "k", fetch: flaky, cache: createCache<FdcFoodData | null>() };
    await expect(lookupFdc("duck", fresh)).rejects.toThrow("network");
    expect(await lookupFdc("duck", fresh)).toEqual(duckFood);
  });
});

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: KeyValueStore = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
  return { storage, data };
}

describe("extra foods", () => {
  it("counts a fetched food toward macros, by weight only", () => {
    const { storage } = memory();
    const store = createExtraStore(() => storage);
    expect(matchFood("duck breast")).toBeNull();
    expect(store.add({ "Duck breast": duckFood, "moon cheese": null })).toBe(1);
    expect(matchFood("duck breasts, sliced")?.id).toBe("fdc-990001");

    const byWeight = resolve({ name: "duck breast", quantity: 200, unit: "g" });
    expect(byWeight.status === "ok" && byWeight.macros.protein).toBeCloseTo(36.6, 6);
    // FDC search results carry no piece or cup weights, so nothing else converts.
    const byCount = resolve({ name: "duck breast", quantity: 2, unit: "each" });
    expect(byCount.status === "unconvertible" && byCount.reason).toBe("no-piece-weight");
  });

  it("never lets a fetched food shadow the bundled table", () => {
    const store = createExtraStore(() => memory().storage);
    store.add({ "chicken breast": { ...duckFood, fdcId: 9 } });
    expect(matchFood("chicken breast")?.id).toBe("chicken-breast");
  });

  it("rejects rows whose energy contradicts their macros", () => {
    expect(plausible(duckFood)).toBe(true);
    expect(plausible({ ...duckFood, kcal: 900 })).toBe(false);
    expect(plausible({ ...duckFood, protein: 60, fat: 50 })).toBe(false);
    const store = createExtraStore(() => memory().storage);
    expect(store.add({ "odd food": { ...duckFood, kcal: 5 } })).toBe(0);
    expect(matchFood("odd food")).toBeNull();
  });

  it("persists lookups and reloads only the valid ones", () => {
    const { storage, data } = memory();
    const first = createExtraStore(() => storage);
    let notified = 0;
    first.subscribe(() => notified++);
    expect(first.getSnapshot()).toBe(0);
    first.add({ "duck breast": duckFood });
    expect(first.getSnapshot()).toBe(1);
    expect(notified).toBe(1);

    setExtraFoods([]);
    const tampered = JSON.parse(data.get(EXTRA_KEY) ?? "{}");
    tampered["bad row"] = { ...duckFood, kcal: 1 };
    data.set(EXTRA_KEY, JSON.stringify(tampered));
    createExtraStore(() => storage).getSnapshot();
    expect(matchFood("duck breast")?.id).toBe("fdc-990001");
    expect(matchFood("bad row")).toBeNull();

    setExtraFoods([]);
    createExtraStore(() => memory({ [EXTRA_KEY]: "{broken" }).storage).getSnapshot();
    expect(matchFood("duck breast")).toBeNull();
  });

  it("still warns about diet for a fetched food, because it has no diet tag", () => {
    createExtraStore(() => memory().storage).add({ "duck breast": duckFood });
    const duckDish = recipe("duck", {
      ingredients: [{ name: "duck breast", quantity: 300, unit: "g", prep: "" }],
    });
    const report = checkPlan(
      plan([duckDish], week("duck", "duck", "duck")),
      prefs({ diet: "vegetarian" }),
      [],
    );
    expect(report.coverage.counted).toBe(1);
    expect(report.warnings.map((issue) => issue.code)).toContain("diet-unverified");
  });
});

describe("POST /api/nutrition", () => {
  const post = (body: unknown, ip: string) =>
    POST(
      new Request("http://localhost/api/nutrition", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify(body),
      }),
    );

  it("says it is unavailable when the server has no FoodData Central key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ names: ["duck breast"] }, "10.1.0.1");
    expect(await res.json()).toEqual({ available: false, foods: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks names up when a key is set, and survives a failed lookup", async () => {
    process.env.USDA_API_KEY = "test-usda-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo) => {
        if (String(url).includes("broken")) return new Response("no", { status: 500 });
        return ok({ foods: String(url).includes("mallard") ? [duck] : [] });
      }),
    );
    const res = await post({ names: ["mallard", "nothing like food", "broken thing"] }, "10.1.0.2");
    const json = await res.json();
    expect(json.available).toBe(true);
    expect(json.foods.mallard).toEqual(duckFood);
    expect(json.foods["nothing like food"]).toBeNull();
    expect(json.foods["broken thing"]).toBeNull();
    expect(JSON.stringify(json)).not.toContain("test-usda-key");
  });

  it("validates the request", async () => {
    expect((await post({ names: [] }, "10.1.0.3")).status).toBe(400);
    expect((await post({ names: ["x".repeat(200)] }, "10.1.0.4")).status).toBe(400);
    expect((await post({ nope: true }, "10.1.0.5")).status).toBe(400);
  });
});
