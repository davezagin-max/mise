import { describe, expect, it } from "vitest";
import { fitScale } from "@/lib/image-client";
import {
  originOf,
  planNarration,
  sampleHint,
  samplesNote,
  scanNarration,
  sourceLabel,
  sourceNote,
} from "@/lib/labels";
import { checkPlan } from "@/lib/plan/check";
import { summarizeChecks } from "@/lib/plan/summary";
import { plan, prefs, recipe, week } from "./helpers";

const base = { model: "claude-opus-5-5", recordedAt: null };
const placeholder = { ...base, mode: "demo" as const, placeholder: true };
const recorded = {
  ...base,
  mode: "demo" as const,
  placeholder: false,
  recordedAt: "2026-11-02T10:00:00.000Z",
};
const live = { ...base, mode: "live" as const, placeholder: false };

describe("where a result came from", () => {
  it("never calls a hand-written sample a model run", () => {
    for (const kind of ["scan", "plan"] as const) {
      const text = `${sourceLabel(placeholder, kind)} ${sourceNote(placeholder, kind)}`;
      expect(text).toContain("written by hand");
      expect(text).toContain("No model produced this");
      expect(text).not.toMatch(/recorded|replay|live/i);
    }
    expect(sampleHint(true)).toBe("Sample output, written by hand");
  });

  it("describes a recorded run as recorded, with its date", () => {
    expect(sourceLabel(recorded, "plan")).toBe("Recorded Claude Opus 5.5 plan");
    expect(sourceNote(recorded, "scan")).toContain("recorded on 2026-11-02");
    expect(sourceNote(recorded, "scan")).not.toContain("hand");
    expect(sampleHint(false)).toBe("Recorded Claude Opus 5.5 run");
  });

  it("describes a live run as live and names the model that answered", () => {
    expect(sourceLabel(live, "scan")).toBe("Live ingredient list from Claude Opus 5.5");
    expect(sourceNote({ ...live, model: "claude-opus-5" }, "plan")).toContain("claude-opus-5 ");
    expect(sourceNote(live, "plan")).toContain("computed by the app");
  });
});

describe("first-screen and loading wording", () => {
  it("picks the origin from the key and the fixture's own flag", () => {
    expect(originOf(true, true)).toBe("live");
    expect(originOf(false, true)).toBe("placeholder");
    expect(originOf(false, false)).toBe("recorded");
  });

  it("never narrates a hand-written sample as Claude at work", () => {
    for (const text of [scanNarration("placeholder"), planNarration("placeholder")]) {
      expect(text).toContain("pre-written");
      expect(text).not.toMatch(/claude|recorded|replay/i);
    }
    expect(scanNarration("recorded")).toMatch(/^Replaying Claude's recorded/);
    expect(planNarration("recorded")).toMatch(/^Replaying Claude's recorded/);
    expect(scanNarration("live")).toMatch(/^Claude is looking at the photo/);
    expect(planNarration("live")).toMatch(/^Claude is planning seven days/);
  });

  it("describes the sample fridges by what their fixtures really are", () => {
    expect(samplesNote([true, true, true])).toContain("they open are pre-written examples");
    expect(samplesNote([true, true, true])).not.toMatch(/recorded/i);
    expect(samplesNote([false, false, false])).toContain("replays a recorded Claude Opus 5.5 run");
    expect(samplesNote([false, false, false])).not.toMatch(/pre-written/);
    expect(samplesNote([true, false, false])).toContain("Some open pre-written examples");
    for (const flags of [[true], [false], [true, false]]) {
      expect(samplesNote(flags)).toContain("drawn illustrations, not photos");
    }
  });
});

describe("summarizeChecks", () => {
  const chicken = recipe("chicken", {
    title: "Chicken and rice",
    minutes: 25,
    ingredients: [
      { name: "chicken breast", quantity: 500, unit: "g", prep: "" },
      { name: "white rice", quantity: 150, unit: "g", prep: "" },
      { name: "moon dust", quantity: 1, unit: "tsp", prep: "" },
    ],
  });
  const p = plan([chicken], week("chicken", "chicken", "chicken"));
  const pantry = [
    { name: "chicken breast", quantity: 1, unit: "kg" },
    { name: "raspberries", quantity: 1, unit: "cup" },
  ];
  const lines = (overrides = {}) => {
    const settings = prefs({ proteinTarget: 120, ...overrides });
    const summary = summarizeChecks(p, checkPlan(p, settings, pantry), settings);
    return Object.fromEntries(summary.map((line) => [line.id, line]));
  };

  it("reports every check in plain words", () => {
    const all = lines();
    expect(all.protein).toMatchObject({ ok: true, text: "7 of 7 days reach 120 g per person" });
    expect(all.diet).toMatchObject({ ok: true, text: "Omnivore: nothing is excluded" });
    expect(all.time).toMatchObject({ ok: true, text: "Longest recipe is 25 min (limit 30)" });
    expect(all.fresh).toMatchObject({
      ok: false,
      text: "1 of 2 fresh foods on hand are cooked before they spoil",
    });
    expect(all.fresh.details[0]).toContain("Raspberries");
    expect(all.data).toMatchObject({ ok: false });
    expect(all.data.details[0]).toContain("moon dust");
    expect(all.fridge.text).toBe("Uses 1 of the 2 foods on hand that the app recognises");
  });

  it("shows what failed and why", () => {
    const all = lines({ diet: "vegetarian", maxMinutes: 20, proteinTarget: 250 });
    expect(all.diet).toMatchObject({
      ok: false,
      text: "1 ingredient not allowed on a vegetarian diet",
    });
    expect(all.diet.details[0]).toContain("Chicken breast");
    expect(all.time.ok).toBe(false);
    expect(all.protein).toMatchObject({ ok: false, text: "0 of 7 days reach 250 g per person" });
    expect(all.protein.details[0]).toBe("A day counts from 225 g (90% of the target).");
  });

  it("names what each diet excludes", () => {
    const fish = recipe("fish", {
      ingredients: [{ name: "cod", quantity: 400, unit: "g", prep: "" }],
    });
    const q = plan([fish], week("fish", "fish", "fish"));
    const settings = prefs({ diet: "pescatarian" });
    const diet = summarizeChecks(q, checkPlan(q, settings, []), settings).find(
      (line) => line.id === "diet",
    );
    expect(diet).toMatchObject({ ok: true, text: "No meat or poultry in any recipe" });
  });
});

describe("fitScale", () => {
  it("shrinks a photo to 1568 px on its long edge and never enlarges one", () => {
    expect(fitScale(4032, 3024)).toBeCloseTo(1568 / 4032, 9);
    expect(fitScale(3024, 4032)).toBeCloseTo(1568 / 4032, 9);
    expect(fitScale(1568, 900)).toBe(1);
    expect(fitScale(800, 600)).toBe(1);
  });
});
