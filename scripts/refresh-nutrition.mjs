#!/usr/bin/env node
/**
 * Compares every row of the bundled nutrition table with USDA FoodData Central
 * and, with --write, replaces the macros with FDC's.
 *
 *   USDA_API_KEY=... pnpm nutrition:refresh            # report only
 *   USDA_API_KEY=... pnpm nutrition:refresh --write    # update lib/nutrition/foods.json
 *
 * Each food's `fdc` field is the search phrase. Rows that differ by more than
 * 15% in energy are marked CHECK so a person can confirm the match is the same
 * food before trusting it. Household weights, shelf life and diet tags are
 * never touched. Get a free key at https://fdc.nal.usda.gov/api-key-signup
 * (about 1,000 requests an hour; this script makes one per food).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { searchFdc } from "../lib/nutrition/fdc.mjs";

for (const file of [".env.local", "../.env"]) {
  if (!process.env.USDA_API_KEY && existsSync(file)) process.loadEnvFile(file);
}
const apiKey = process.env.USDA_API_KEY;
if (!apiKey) {
  console.error("USDA_API_KEY is not set. Add it to .env.local or ../.env, then re-run.");
  process.exit(1);
}

const FILE = "lib/nutrition/foods.json";
const write = process.argv.includes("--write");
const data = JSON.parse(readFileSync(FILE, "utf8"));
let matched = 0;
let flagged = 0;

for (const food of data.foods) {
  let found = null;
  try {
    found = await searchFdc(food.fdc, { apiKey });
  } catch (error) {
    console.error(`ERROR  ${food.id}: ${error instanceof Error ? error.message : error}`);
    break;
  }
  if (!found) {
    console.log(`MISS   ${food.id}  ("${food.fdc}")`);
    continue;
  }
  matched += 1;
  const drift = food.kcal > 0 ? Math.abs(found.kcal - food.kcal) / food.kcal : found.kcal > 5 ? 1 : 0;
  const mark = drift > 0.15 ? "CHECK " : "ok    ";
  if (drift > 0.15) flagged += 1;
  console.log(
    `${mark} ${food.id}: ${food.kcal} -> ${found.kcal} kcal, protein ${food.protein} -> ${found.protein}  [${found.dataType} ${found.fdcId}: ${found.description}]`,
  );
  if (write && drift <= 0.15) {
    Object.assign(food, {
      kcal: found.kcal,
      protein: found.protein,
      carbs: found.carbs,
      fat: found.fat,
      fiber: found.fiber,
      fdcId: found.fdcId,
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}

console.log(`\n${matched} of ${data.foods.length} matched, ${flagged} need a look.`);
if (write) {
  data.meta.verifiedAgainstFdc = flagged === 0 && matched === data.foods.length;
  data.meta.refreshed = new Date().toISOString().slice(0, 10);
  data.meta.provenance = `Macros refreshed from the FoodData Central API on ${data.meta.refreshed} for rows within 15% of the hand-entered figure; rows marked CHECK by the refresh script keep their hand-entered values. Household weights, shelf life and diet tags are hand-entered.`;
  const lines = data.foods.map((food) => `    ${JSON.stringify(food)}`).join(",\n");
  const meta = JSON.stringify(data.meta, null, 2).replace(/\n/g, "\n  ");
  writeFileSync(FILE, `{\n  "meta": ${meta},\n  "foods": [\n${lines}\n  ]\n}\n`);
  console.log(`wrote ${FILE}. Run pnpm test: the data checks must still pass.`);
}
