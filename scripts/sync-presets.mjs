#!/usr/bin/env node
/**
 * Rebuilds fixtures/presets.json from the sample definitions and the current
 * scan fixtures, so each plan preset asks for a plan from exactly the
 * ingredient list its scan returned.
 *
 *   pnpm presets
 *
 * `pnpm record` runs this between recording the scans and recording the plans.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SAMPLES = JSON.parse(readFileSync("lib/samples.json", "utf8"));
const scans = JSON.parse(readFileSync("fixtures/scan.json", "utf8"));
const presets = [];
for (const sample of SAMPLES) {
  presets.push({ route: "/api/scan", body: { demoId: sample.id, sampleId: sample.id } });
}
for (const sample of SAMPLES) {
  const scan = scans[sample.id];
  if (!scan) throw new Error(`fixtures/scan.json has no entry for "${sample.id}"`);
  presets.push({
    route: "/api/plan",
    body: {
      demoId: sample.id,
      ingredients: scan.data.items.map(({ name, quantity, unit }) => ({ name, quantity, unit })),
      prefs: sample.prefs,
    },
  });
}
writeFileSync("fixtures/presets.json", `${JSON.stringify(presets, null, 2)}\n`);
console.log(`wrote fixtures/presets.json (${presets.length} presets)`);
