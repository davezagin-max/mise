/**
 * Turns a check report into the short lines shown in the "Checked by code"
 * panel. Pure, so the wording is tested and the component stays dumb.
 */
import type { MealPlan, Prefs } from "../types";
import { PROTEIN_TOLERANCE, type PlanReport } from "./check";

export interface CheckLine {
  id: "protein" | "diet" | "time" | "fresh" | "data" | "fridge";
  label: string;
  ok: boolean;
  text: string;
  /** Extra lines, shown when the check did not pass cleanly. */
  details: string[];
}

const EXCLUDES: Record<Prefs["diet"], string> = {
  omnivore: "",
  pescatarian: "meat or poultry",
  vegetarian: "meat or fish",
  vegan: "animal products",
};

export function summarizeChecks(plan: MealPlan, report: PlanReport, prefs: Prefs): CheckLine[] {
  const messages = (code: string) =>
    [...report.errors, ...report.warnings]
      .filter((issue) => issue.code === code)
      .map((issue) => issue.message);

  const onTarget = report.days.filter((day) => day.proteinOk).length;
  const floor = Math.round(prefs.proteinTarget * PROTEIN_TOLERANCE);
  const protein: CheckLine = {
    id: "protein",
    label: "Protein",
    ok: report.days.length > 0 && onTarget === report.days.length,
    text: `${onTarget} of ${report.days.length} days reach ${prefs.proteinTarget} g per person`,
    details:
      onTarget === report.days.length
        ? []
        : [`A day counts from ${floor} g (90% of the target).`, ...messages("protein-short")],
  };

  const broken = messages("diet");
  const unverified = messages("diet-unverified");
  const diet: CheckLine = {
    id: "diet",
    label: "Diet",
    ok: broken.length === 0,
    text:
      broken.length > 0
        ? `${broken.length} ingredient${broken.length === 1 ? "" : "s"} not allowed on a ${prefs.diet} diet`
        : prefs.diet === "omnivore"
          ? "Omnivore: nothing is excluded"
          : `No ${EXCLUDES[prefs.diet]} in any recipe`,
    details: [...broken, ...unverified],
  };

  const longest = plan.recipes.reduce((max, recipe) => Math.max(max, recipe.minutes), 0);
  const slow = messages("over-time");
  const time: CheckLine = {
    id: "time",
    label: "Cook time",
    ok: slow.length === 0,
    text: `Longest recipe is ${longest} min (limit ${prefs.maxMinutes})`,
    details: slow,
  };

  const inTime = report.perishables.filter((use) => use.status === "ok").length;
  const fresh: CheckLine = {
    id: "fresh",
    label: "Perishables",
    ok: report.perishables.every((use) => use.status === "ok"),
    text:
      report.perishables.length === 0
        ? "Nothing on hand spoils within a week"
        : `${inTime} of ${report.perishables.length} fresh foods on hand are cooked before they spoil`,
    details: [...messages("late-perishable"), ...messages("unused-perishable")],
  };

  const { counted, total, missing } = report.coverage;
  const data: CheckLine = {
    id: "data",
    label: "Nutrition data",
    ok: counted === total,
    text: `${counted} of ${total} ingredient lines counted in the nutrition totals`,
    details:
      missing.length > 0
        ? [`Left out, so the totals are a little low: ${missing.join(", ")}.`]
        : [],
  };

  const fridge: CheckLine = {
    id: "fridge",
    label: "Your fridge",
    ok: true,
    text: `Uses ${report.pantry.used} of the ${report.pantry.total} foods on hand that the app recognises`,
    details: [],
  };

  return [protein, diet, time, fresh, data, fridge];
}
