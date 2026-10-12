/**
 * Every fixture must be a genuine output of the real pipeline: it goes through
 * the same schemas, validators and checks the live path uses. These tests
 * compare against each fixture's own `placeholder` flag, so they keep passing
 * once `pnpm record` replaces the hand-written samples with real runs.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import planStore from "@/fixtures/plan.json";
import presets from "@/fixtures/presets.json";
import scanStore from "@/fixtures/scan.json";
import { ZERO_USAGE } from "@/lib/config";
import type { Fixture, FixtureStore } from "@/lib/demo";
import { buildGroceryList } from "@/lib/grocery";
import { resolve } from "@/lib/nutrition/macros";
import { checkPlan, needsRevision } from "@/lib/plan/check";
import { PlanBody, PlanWire, normalizePlan, type PlanData } from "@/lib/plan/schema";
import { SAMPLES, SAMPLE_IDS } from "@/lib/samples";
import { ScanBody, ScanWire, normalizeScan } from "@/lib/scan/schema";
import type { ScanResult } from "@/lib/types";
import { parseUnit } from "@/lib/units";

const scans = scanStore as unknown as FixtureStore<ScanResult>;
const plans = planStore as unknown as FixtureStore<PlanData>;
const all: [string, Fixture][] = [
  ...Object.entries(scans).map(([key, f]): [string, Fixture] => [`scan/${key}`, f]),
  ...Object.entries(plans).map(([key, f]): [string, Fixture] => [`plan/${key}`, f]),
];

describe("fixture bookkeeping", () => {
  it.each(all)("%s is labelled honestly", (_name, fixture) => {
    expect(typeof fixture.placeholder).toBe("boolean");
    if (fixture.placeholder) {
      // A hand-written sample never claims a time, tokens or a cost.
      expect(fixture.recordedAt).toBeNull();
      expect(fixture.usage).toEqual(ZERO_USAGE);
      expect(fixture.costUsd).toBe(0);
    } else {
      expect(Number.isNaN(Date.parse(fixture.recordedAt ?? ""))).toBe(false);
      expect(fixture.usage.output_tokens).toBeGreaterThan(0);
      expect(fixture.costUsd).toBeGreaterThan(0);
    }
  });

  it("has a scan, a plan and a picture for every sample fridge", () => {
    expect(Object.keys(scans).sort()).toEqual([...SAMPLE_IDS].sort());
    expect(Object.keys(plans).sort()).toEqual([...SAMPLE_IDS].sort());
    expect(SAMPLES.map((sample) => sample.id)).toEqual([...SAMPLE_IDS]);
    for (const sample of SAMPLES) {
      expect(existsSync(path.join(process.cwd(), "public", sample.image)), sample.image).toBe(true);
      expect(PlanBody.shape.prefs.safeParse(sample.prefs).success, sample.id).toBe(true);
    }
  });

  it("lists every fixture in presets.json with a body its route accepts", () => {
    const keys = presets.map((preset) => `${preset.route}:${preset.body.demoId}`).sort();
    const expected = [
      ...Object.keys(scans).map((key) => `/api/scan:${key}`),
      ...Object.keys(plans).map((key) => `/api/plan:${key}`),
    ].sort();
    expect(keys).toEqual(expected);
    for (const preset of presets) {
      const schema = preset.route === "/api/scan" ? ScanBody : PlanBody;
      expect(schema.safeParse(preset.body).success, `${preset.route} ${preset.body.demoId}`).toBe(
        true,
      );
    }
  });
});

describe.each(Object.entries(scans))("scan fixture %s", (_key, fixture) => {
  it("matches the wire schema and is already in validated form", () => {
    const parsed = ScanWire.parse(fixture.data);
    expect(normalizeScan(parsed)).toEqual(fixture.data);
  });

  it("is a usable ingredient list", () => {
    const { items, summary } = fixture.data;
    expect(items.length).toBeGreaterThan(0);
    expect(summary.length).toBeGreaterThan(0);
    if (!fixture.placeholder) return; // A recorded scan is kept as the model returned it.
    // A hand-written sample has to be a good one: mostly foods the nutrition data
    // knows, only real units, and all three confidence levels on show.
    expect(items.length).toBeGreaterThanOrEqual(12);
    const known = items.filter((item) => resolve(item).status !== "unmatched");
    expect(known.length).toBe(items.length);
    for (const item of items) expect(parseUnit(item.unit), item.name).not.toBeNull();
    expect(new Set(items.map((item) => item.confidence)).size).toBe(3);
  });
});

describe.each(Object.entries(plans))("plan fixture %s", (key, fixture) => {
  const sample = SAMPLES.find((entry) => entry.id === key)!;
  const pantry = scans[key].data.items;
  const plan = normalizePlan(PlanWire.parse(fixture.data.plan));
  const report = checkPlan(plan, sample.prefs, pantry);

  it("matches the wire schema and is already in validated form", () => {
    expect(plan).toEqual(fixture.data.plan);
    expect([1, 2]).toContain(fixture.data.attempts);
    expect(fixture.data.revisedFor.length > 0).toBe(fixture.data.attempts === 2);
  });

  it("passes every hard check for its sample's preferences", () => {
    expect(report.errors).toEqual([]);
    expect(report.days).toHaveLength(7);
    for (const recipe of plan.recipes) {
      expect(recipe.minutes, recipe.title).toBeLessThanOrEqual(sample.prefs.maxMinutes);
    }
  });

  it("is a sample worth showing", () => {
    if (!fixture.placeholder) return; // A recorded run is shown as it came, flaws included.
    expect(needsRevision(report)).toEqual([]);
    expect(report.days.every((day) => day.proteinOk)).toBe(true);
    expect(report.coverage.counted).toBe(report.coverage.total);
    expect(report.perishables.every((use) => use.status === "ok")).toBe(true);
    expect(report.pantry.used).toBe(report.pantry.total);
    for (const day of report.days) {
      expect(day.macros.kcal, `day ${day.day}`).toBeGreaterThan(1200);
      expect(day.macros.kcal, `day ${day.day}`).toBeLessThan(2600);
    }
  });

  it("produces a grocery list", () => {
    const list = buildGroceryList(plan, sample.prefs, pantry);
    for (const group of list.groups) {
      for (const item of group.items) expect(item.amount, item.name).not.toBe("");
    }
    if (!fixture.placeholder) return;
    expect(list.buyCount).toBeGreaterThan(5);
    expect(list.covered.length).toBeGreaterThan(5);
  });
});
