// @ts-check
/**
 * Optional lookups against USDA FoodData Central (https://fdc.nal.usda.gov/).
 *
 * The app works from its bundled table. When `USDA_API_KEY` is set on the
 * server, ingredients the table does not have are looked up here, cached, and
 * counted toward the macros like any other food. The same code powers
 * `pnpm nutrition:refresh`, which compares the bundled table with FDC.
 *
 * Plain JavaScript on purpose: a Node script and the Next.js route both import
 * this file, with no TypeScript loader in between.
 *
 * Nothing here has been run against the live API (no key was available when it
 * was written). The response shape follows the published FDC API guide and is
 * exercised in tests with a stand-in `fetch`.
 */

const SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";

/**
 * FDC identifies a nutrient by an id and by an older "number". Either may be
 * present depending on the endpoint, so both are accepted.
 */
const NUTRIENTS = {
  kcal: { ids: [1008, 2047, 2048], numbers: ["208", "957", "958"] },
  protein: { ids: [1003], numbers: ["203"] },
  fat: { ids: [1004], numbers: ["204"] },
  carbs: { ids: [1005], numbers: ["205"] },
  fiber: { ids: [1079], numbers: ["291"] },
};

/**
 * @typedef {{ kcal: number, protein: number, carbs: number, fat: number, fiber: number }} FdcMacros
 * @typedef {{ fdcId: number, description: string, dataType: string } & FdcMacros} FdcFood
 */

/**
 * @param {unknown} list
 * @param {{ ids: number[], numbers: string[] }} wanted
 * @param {string} [unit] Required unit name, compared without case.
 * @returns {number | null}
 */
function pick(list, wanted, unit) {
  if (!Array.isArray(list)) return null;
  // Earlier entries in `wanted` are preferred (plain energy before the Atwater variants).
  for (let i = 0; i < wanted.ids.length; i++) {
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const sameId = entry.nutrientId === wanted.ids[i];
      const sameNumber = String(entry.nutrientNumber ?? "") === wanted.numbers[i];
      if (!sameId && !sameNumber) continue;
      if (unit && String(entry.unitName ?? "").toLowerCase() !== unit) continue;
      const value = Number(entry.value);
      if (Number.isFinite(value) && value >= 0) return value;
    }
  }
  return null;
}

/**
 * Per-100g macros from one FDC search result, or null when the row cannot be
 * trusted: energy, protein, fat or carbohydrate missing, or figures that are
 * not physically possible. Fibre is optional and defaults to zero.
 * @param {unknown} food
 * @returns {FdcMacros | null}
 */
export function macrosFromFdc(food) {
  if (!food || typeof food !== "object") return null;
  const list = /** @type {{ foodNutrients?: unknown }} */ (food).foodNutrients;
  const kcal = pick(list, NUTRIENTS.kcal, "kcal");
  const protein = pick(list, NUTRIENTS.protein);
  const fat = pick(list, NUTRIENTS.fat);
  const carbs = pick(list, NUTRIENTS.carbs);
  const fiber = pick(list, NUTRIENTS.fiber) ?? 0;
  if (kcal === null || protein === null || fat === null || carbs === null) return null;
  if (kcal > 900 || protein + fat + carbs > 101 || fiber > carbs + 0.5) return null;
  const round = (/** @type {number} */ value) => Math.round(value * 10) / 10;
  return {
    kcal: Math.round(kcal),
    protein: round(protein),
    carbs: round(carbs),
    fat: round(fat),
    fiber: round(fiber),
  };
}

/**
 * The best SR Legacy or Foundation match for a search phrase, or null.
 * The key travels in a header, never in the URL.
 * @param {string} query
 * @param {{ apiKey: string, fetch?: typeof fetch, signal?: AbortSignal }} options
 * @returns {Promise<FdcFood | null>}
 */
export async function searchFdc(query, options) {
  const send = options.fetch ?? fetch;
  const url = new URL(SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("dataType", "SR Legacy,Foundation");
  url.searchParams.set("pageSize", "3");
  const response = await send(url, {
    headers: { "X-Api-Key": options.apiKey, accept: "application/json" },
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`FoodData Central returned HTTP ${response.status}`);
  const body = await response.json();
  const foods = Array.isArray(body?.foods) ? body.foods : [];
  for (const food of foods) {
    const macros = macrosFromFdc(food);
    const fdcId = Number(food?.fdcId);
    if (!macros || !Number.isInteger(fdcId)) continue;
    return {
      fdcId,
      description: String(food.description ?? query).slice(0, 120),
      dataType: String(food.dataType ?? ""),
      ...macros,
    };
  }
  return null;
}

/**
 * A small in-memory cache with expiry. Misses are cached too, so a food FDC
 * does not have is not asked for again on every request.
 * @template T
 * @param {{ ttlMs?: number, max?: number, now?: () => number }} [options]
 */
export function createCache(options = {}) {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const max = options.max ?? 500;
  const now = options.now ?? Date.now;
  /** @type {Map<string, { value: T, expires: number }>} */
  const entries = new Map();
  return {
    /** @param {string} key @returns {{ value: T } | null} */
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expires <= now()) {
        entries.delete(key);
        return null;
      }
      return { value: entry.value };
    },
    /** @param {string} key @param {T} value */
    set(key, value) {
      if (entries.size >= max && !entries.has(key)) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, { value, expires: now() + ttlMs });
    },
    get size() {
      return entries.size;
    },
  };
}

/** @type {ReturnType<typeof createCache<FdcFood | null>>} */
const shared = createCache();

/**
 * `searchFdc` behind a cache. Errors are not cached, so a network blip does
 * not hide a food for a day.
 * @param {string} name
 * @param {{ apiKey: string, fetch?: typeof fetch, signal?: AbortSignal, cache?: ReturnType<typeof createCache<FdcFood | null>> }} options
 * @returns {Promise<FdcFood | null>}
 */
export async function lookupFdc(name, options) {
  const cache = options.cache ?? shared;
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit) return hit.value;
  const food = await searchFdc(key, options);
  cache.set(key, food);
  return food;
}
