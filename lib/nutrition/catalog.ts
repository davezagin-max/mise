/**
 * The food catalog as prompt text. Both Claude calls get it so the names they
 * return are names the matcher knows; the plan call also learns which units
 * each food can be converted from. It is stable and long, which is why the
 * system prompts that include it are cached.
 */
import { AISLES, AISLE_LABELS, FOODS, type Food } from "./foods";

/** The name to show the model. The matcher resolves it back to this food (tested). */
export function catalogName(food: Food): string {
  return food.name.toLowerCase();
}

function unitsFor(food: Food): string {
  const extra = [...(food.cup ? ["vol"] : []), ...Object.keys(food.units ?? {})];
  return extra.length > 0 ? ` (${extra.join(", ")})` : "";
}

/** One line per aisle: `name (vol, each, clove)`. `vol` means cup, tbsp, tsp and ml work. */
export function catalogText(options: { units: boolean }): string {
  return AISLES.map((aisle) => {
    const foods = FOODS.filter((food) => food.aisle === aisle).map(
      (food) => `${catalogName(food)}${options.units ? unitsFor(food) : ""}`,
    );
    return `${AISLE_LABELS[aisle]}: ${foods.join("; ")}`;
  }).join("\n");
}
