/**
 * Unit conversion. Pure functions, no I/O.
 *
 * Three kinds of unit:
 *   mass    grams are grams, so this always converts.
 *   volume  needs the food's density (grams per US cup). No density, no answer.
 *   count   needs the food's weight for that piece ("1 clove", "2 slices").
 *
 * The rule that matters: when a conversion is not defined, return a typed
 * failure. Never assume water density or an "average" piece.
 */

export type UnitKind = "mass" | "volume" | "count";

export interface Unit {
  /** Canonical id, also the short label: "g", "cup", "clove". */
  id: string;
  kind: UnitKind;
  /** Grams for mass, millilitres for volume, 1 for count. */
  factor: number;
  plural: string;
}

const TSP_ML = 4.92892159375;
export const CUP_ML = 236.5882365;

const UNITS: Unit[] = [
  { id: "g", kind: "mass", factor: 1, plural: "g" },
  { id: "kg", kind: "mass", factor: 1000, plural: "kg" },
  { id: "mg", kind: "mass", factor: 0.001, plural: "mg" },
  { id: "oz", kind: "mass", factor: 28.349523125, plural: "oz" },
  { id: "lb", kind: "mass", factor: 453.59237, plural: "lb" },

  { id: "ml", kind: "volume", factor: 1, plural: "ml" },
  { id: "l", kind: "volume", factor: 1000, plural: "l" },
  { id: "tsp", kind: "volume", factor: TSP_ML, plural: "tsp" },
  { id: "tbsp", kind: "volume", factor: TSP_ML * 3, plural: "tbsp" },
  { id: "fl oz", kind: "volume", factor: TSP_ML * 6, plural: "fl oz" },
  { id: "cup", kind: "volume", factor: CUP_ML, plural: "cups" },
  { id: "pint", kind: "volume", factor: CUP_ML * 2, plural: "pints" },
  { id: "quart", kind: "volume", factor: CUP_ML * 4, plural: "quarts" },
  { id: "gallon", kind: "volume", factor: CUP_ML * 16, plural: "gallons" },
  { id: "pinch", kind: "volume", factor: TSP_ML / 16, plural: "pinches" },
  { id: "dash", kind: "volume", factor: TSP_ML / 8, plural: "dashes" },

  { id: "each", kind: "count", factor: 1, plural: "each" },
  { id: "clove", kind: "count", factor: 1, plural: "cloves" },
  { id: "head", kind: "count", factor: 1, plural: "heads" },
  { id: "bunch", kind: "count", factor: 1, plural: "bunches" },
  { id: "stalk", kind: "count", factor: 1, plural: "stalks" },
  { id: "slice", kind: "count", factor: 1, plural: "slices" },
  { id: "can", kind: "count", factor: 1, plural: "cans" },
  { id: "jar", kind: "count", factor: 1, plural: "jars" },
  { id: "package", kind: "count", factor: 1, plural: "packages" },
  { id: "block", kind: "count", factor: 1, plural: "blocks" },
  { id: "stick", kind: "count", factor: 1, plural: "sticks" },
  { id: "fillet", kind: "count", factor: 1, plural: "fillets" },
  { id: "link", kind: "count", factor: 1, plural: "links" },
  { id: "ear", kind: "count", factor: 1, plural: "ears" },
  { id: "spear", kind: "count", factor: 1, plural: "spears" },
  { id: "container", kind: "count", factor: 1, plural: "containers" },
];

const BY_ID = new Map(UNITS.map((unit) => [unit.id, unit]));

/** Other spellings. Plurals ending in "s" or "es" are handled by `parseUnit`. */
const ALIASES: Record<string, string> = {
  gram: "g",
  gm: "g",
  gr: "g",
  kilo: "kg",
  kilogram: "kg",
  milligram: "mg",
  ounce: "oz",
  pound: "lb",
  lbs: "lb",
  milliliter: "ml",
  millilitre: "ml",
  cc: "ml",
  liter: "l",
  litre: "l",
  teaspoon: "tsp",
  tablespoon: "tbsp",
  tbs: "tbsp",
  tbl: "tbsp",
  floz: "fl oz",
  "fluid ounce": "fl oz",
  "fluid oz": "fl oz",
  pt: "pint",
  qt: "quart",
  gal: "gallon",
  "": "each",
  ea: "each",
  whole: "each",
  piece: "each",
  pc: "each",
  count: "each",
  ct: "each",
  item: "each",
  unit: "each",
  small: "each",
  medium: "each",
  large: "each",
  breast: "each",
  thigh: "each",
  rib: "stalk",
  rasher: "slice",
  tin: "can",
  pkg: "package",
  pack: "package",
  packet: "package",
  bag: "package",
  box: "package",
  filet: "fillet",
  cob: "ear",
  tub: "container",
  pot: "container",
  carton: "container",
  bottle: "container",
};

export const UNIT_IDS = UNITS.map((unit) => unit.id);

/** Reads a unit as people write it ("Tbsp.", "ounces", "cloves"). Null when unknown. */
export function parseUnit(raw: string): Unit | null {
  const text = raw.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const candidates = [text];
  if (text.endsWith("es")) candidates.push(text.slice(0, -2));
  if (text.endsWith("s")) candidates.push(text.slice(0, -1));
  for (const candidate of candidates) {
    const id = BY_ID.has(candidate) ? candidate : ALIASES[candidate];
    if (id !== undefined) return BY_ID.get(id) ?? null;
  }
  return null;
}

/** What a food knows about its own measures. A subset of `Food`. */
export interface Measures {
  cup?: number;
  units?: Record<string, number>;
}

export type GramFailure = "bad-quantity" | "unknown-unit" | "no-density" | "no-piece-weight";

export type GramResult =
  { ok: true; grams: number; via: UnitKind } | { ok: false; reason: GramFailure };

/**
 * Converts a quantity to grams.
 * Mass needs nothing; volume needs `measures.cup`; count needs `measures.units[unit]`.
 */
export function toGrams(quantity: number, unit: string, measures?: Measures | null): GramResult {
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, reason: "bad-quantity" };
  const parsed = parseUnit(unit);
  if (!parsed) return { ok: false, reason: "unknown-unit" };

  if (parsed.kind === "mass") {
    return { ok: true, grams: quantity * parsed.factor, via: "mass" };
  }
  if (parsed.kind === "volume") {
    const cup = measures?.cup;
    if (!cup || cup <= 0) return { ok: false, reason: "no-density" };
    return { ok: true, grams: ((quantity * parsed.factor) / CUP_ML) * cup, via: "volume" };
  }
  const piece = measures?.units?.[parsed.id];
  if (!piece || piece <= 0) return { ok: false, reason: "no-piece-weight" };
  return { ok: true, grams: quantity * piece, via: "count" };
}

/** The inverse of `toGrams`: how many of `unit` make up `grams`. Null when undefined. */
export function fromGrams(grams: number, unit: string, measures?: Measures | null): number | null {
  if (!Number.isFinite(grams) || grams < 0) return null;
  const one = toGrams(1, unit, measures);
  return one.ok ? grams / one.grams : null;
}

/** Converts between two units of the same kind (oz to g, tbsp to cup). Null otherwise. */
export function convert(quantity: number, from: string, to: string): number | null {
  const a = parseUnit(from);
  const b = parseUnit(to);
  if (!a || !b || a.kind !== b.kind || !Number.isFinite(quantity)) return null;
  if (a.kind === "count") return a.id === b.id ? quantity : null;
  return (quantity * a.factor) / b.factor;
}

export const FAILURE_TEXT: Record<GramFailure, string> = {
  "bad-quantity": "the quantity is not a positive number",
  "unknown-unit": "the unit is not one this app can convert",
  "no-density": "there is no cup weight for this food, so a volume cannot become grams",
  "no-piece-weight": "there is no weight for one of these",
};

const FRACTIONS: [number, string][] = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];

/**
 * A number as a cook would write it: "1½", "⅓", "12". Values are snapped to the
 * nearest eighth or third when they are within 3% of one, otherwise shown to
 * one or two decimals.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 20) return String(Math.round(value));
  const whole = Math.floor(value);
  const rest = value - whole;
  if (rest <= 0.03 && whole > 0) return String(whole);
  if (rest >= 0.97) return String(whole + 1);
  let best = FRACTIONS[0];
  for (const fraction of FRACTIONS) {
    if (Math.abs(fraction[0] - rest) < Math.abs(best[0] - rest)) best = fraction;
  }
  if (Math.abs(best[0] - rest) <= 0.03) return `${whole > 0 ? whole : ""}${best[1]}`;
  return String(Number(value.toFixed(value >= 10 ? 1 : 2)));
}

/** "200 g", "1½ cups", "2 cloves", "3" (for `each`). Unknown units are shown as written. */
export function formatAmount(quantity: number, unit: string): string {
  const parsed = parseUnit(unit);
  if (!parsed) return `${formatNumber(quantity)} ${unit}`.trim();
  if (parsed.kind === "mass" || parsed.id === "ml" || parsed.id === "l") {
    const fine = parsed.id === "g" || parsed.id === "ml" ? 1 : 2;
    const shown = quantity >= 10 ? Math.round(quantity) : Number(quantity.toFixed(fine));
    return `${shown} ${parsed.id}`;
  }
  if (parsed.id === "each") return formatNumber(quantity);
  const label = quantity > 1.01 ? parsed.plural : parsed.id;
  return `${formatNumber(quantity)} ${label}`;
}

/** Grams for display: nearest gram under 100 g, nearest 5 g above. */
export function formatGrams(grams: number): string {
  if (grams < 1) return "<1 g";
  if (grams < 100) return `${Math.round(grams)} g`;
  if (grams < 1000) return `${Math.round(grams / 5) * 5} g`;
  return `${(Math.round(grams / 10) / 100).toFixed(2).replace(/\.?0+$/, "")} kg`;
}
