"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { CostMeter } from "@/components/kit/CostMeter";
import { sourceLabel, sourceNote } from "@/lib/labels";
import { ZERO_MACROS, addMacros, scaleMacros, type Macros } from "@/lib/nutrition/macros";
import { pantryFoods, type PlanReport } from "@/lib/plan/check";
import { cookEvents, portionsFor } from "@/lib/plan/schedule";
import type { CheckLine } from "@/lib/plan/summary";
import { planIsStale, type Session } from "@/lib/session";
import { PREF_LIMITS, type Prefs, type Slot } from "@/lib/types";
import { RecipeCard } from "./RecipeCard";
import { AlertIcon, ArrowIcon, CheckIcon, Eyebrow, Notice, Stepper, Tag, button } from "./ui";

const SLOT_TEXT: Record<Slot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

const whole = (value: number) => Math.round(value).toLocaleString("en-US");

function ProteinBar({
  protein,
  target,
  scale,
  ok,
}: {
  protein: number;
  target: number;
  scale: number;
  ok: boolean;
}) {
  const percent = (value: number) => `${Math.min(100, (value / scale) * 100)}%`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>
          <span className="num text-lg font-semibold">{whole(protein)}</span>{" "}
          <span className="text-muted">g protein</span>
        </span>
        {ok ? (
          <Tag tone="good">
            <CheckIcon width={12} height={12} /> On target
          </Tag>
        ) : (
          <Tag tone="warn">
            <AlertIcon width={12} height={12} /> {whole(target - protein)} g short
          </Tag>
        )}
      </div>
      <div
        role="img"
        aria-label={`${whole(protein)} grams of protein against a target of ${target}`}
        className="relative h-3 rounded-xs bg-sunk"
      >
        <div
          className={`h-full rounded-xs ${ok ? "bg-accent" : "bg-warn"}`}
          style={{ width: percent(protein) }}
        />
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-fg" style={{ left: percent(target) }} />
      </div>
    </div>
  );
}

/** Where the day's energy comes from: 4 kcal per gram of protein and carbohydrate, 9 for fat. */
function EnergySplit({ macros }: { macros: Macros }) {
  const parts = [
    { key: "Protein", grams: macros.protein, kcal: macros.protein * 4, color: "bg-accent" },
    { key: "Carbs", grams: macros.carbs, kcal: macros.carbs * 4, color: "bg-wheat" },
    { key: "Fat", grams: macros.fat, kcal: macros.fat * 9, color: "bg-clay" },
  ];
  const total = parts.reduce((sum, part) => sum + part.kcal, 0) || 1;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-1.5 gap-px overflow-hidden rounded-xs" aria-hidden="true">
        {parts.map((part) => (
          <div
            key={part.key}
            className={part.color}
            style={{ width: `${(part.kcal / total) * 100}%` }}
          />
        ))}
      </div>
      <p className="flex flex-wrap gap-x-2.5 text-xs text-muted">
        <span>
          <span className="num">{whole(macros.kcal)}</span> kcal
        </span>
        <span>
          carbs <span className="num">{whole(macros.carbs)}</span> g
        </span>
        <span>
          fat <span className="num">{whole(macros.fat)}</span> g
        </span>
        <span>
          fibre <span className="num">{whole(macros.fiber)}</span> g
        </span>
      </p>
    </div>
  );
}

function Checks({ lines }: { lines: CheckLine[] }) {
  return (
    <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {lines.map((line) => (
        <li key={line.id} className="flex gap-2 text-sm">
          <span
            className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm ${
              line.ok ? "bg-accent text-accent-fg" : "bg-warn-soft text-warn"
            }`}
          >
            {line.ok ? <CheckIcon width={14} height={14} /> : <AlertIcon width={14} height={14} />}
          </span>
          <span className="min-w-0">
            <span className="font-semibold">{line.label}. </span>
            <span>{line.text}.</span>
            <span className="sr-only">{line.ok ? " Passed." : " Needs attention."}</span>
            {line.details.length > 0 && (
              <span className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
                {line.details.map((detail) => (
                  <span key={detail}>{detail}</span>
                ))}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface WeekStepProps {
  session: Session;
  report: PlanReport;
  checks: CheckLine[];
  isLive: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  notice: ReactNode;
  onPrefs: (prefs: Partial<Prefs>) => void;
  onPortions: (recipeId: string, portions: number | null) => void;
  onGroceries: () => void;
  onReplan: () => void;
}

export function WeekStep({
  session,
  report,
  checks,
  isLive,
  headingRef,
  notice,
  onPrefs,
  onPortions,
  onGroceries,
  onReplan,
}: WeekStepProps) {
  const data = session.plan;
  const [selected, setSelected] = useState<string | null>(null);
  const recipeHeading = useRef<HTMLHeadingElement>(null);
  const opened = useRef(false);

  // On a phone the recipe replaces the week, so move focus (and the scroll position) to it.
  useEffect(() => {
    if (selected) {
      opened.current = true;
      if (window.matchMedia("(max-width: 1023px)").matches) {
        window.scrollTo({ top: 0 });
        recipeHeading.current?.focus({ preventScroll: true });
      }
    } else if (opened.current) {
      window.scrollTo({ top: 0 });
    }
  }, [selected]);

  const plan = data?.plan;
  const events = useMemo(() => (plan ? cookEvents(plan) : []), [plan]);
  const onHand = useMemo(
    () => new Set(pantryFoods(session.items).map((food) => food.id)),
    [session.items],
  );
  if (!data || !plan) return null;

  /** For each meal, the day its food was cooked. */
  const cookedOn = new Map<string, number>();
  for (const event of events) {
    for (const meal of event.meals) cookedOn.set(`${meal.day}:${meal.slot}`, event.day);
  }

  const fallback = plan.days[0]?.meals.find((meal) => meal.slot === "dinner")?.recipeId;
  const shownId = selected ?? fallback ?? plan.recipes[0]?.id;
  const shown = plan.recipes.find((recipe) => recipe.id === shownId);
  const scale = Math.max(
    session.prefs.proteinTarget * 1.2,
    ...report.days.map((day) => day.macros.protein * 1.04),
  );
  const stale = planIsStale(session);
  const average =
    report.days.length > 0
      ? scaleMacros(
          report.days.reduce((sum, day) => addMacros(sum, day.macros), ZERO_MACROS),
          1 / report.days.length,
        )
      : null;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-10">
      <div className={`flex min-w-0 flex-col gap-6 ${selected ? "hidden lg:flex" : ""}`}>
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Eyebrow>Step 3 of 4 · Your week</Eyebrow>
            {session.planMeta && <Tag>{sourceLabel(session.planMeta, "plan")}</Tag>}
          </div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-3xl leading-tight outline-none sm:text-[2.75rem]"
          >
            {plan.title}
          </h1>
          <p className="max-w-prose text-sm sm:text-base">{plan.summary}</p>
          <p className="max-w-prose text-sm text-muted">
            Tap any meal to see its recipe. Every number on this page, from calories to the grocery
            list, is computed by code from a nutrition table, not by the AI.
          </p>
          {data.attempts > 1 && data.revisedFor.length > 0 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer font-medium text-fg">
                The app sent the first draft back once
              </summary>
              <ul className="mt-1 list-disc pl-5">
                {data.revisedFor.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </details>
          )}
        </header>

        {stale && (
          <Notice
            tone="warn"
            title="This plan was written for different preferences"
            actions={
              isLive ? (
                <button type="button" onClick={onReplan} className={button.secondary}>
                  Plan again
                </button>
              ) : undefined
            }
          >
            It was written for a {session.plannedFor?.diet} diet and{" "}
            {session.plannedFor?.maxMinutes}-minute recipes. The checks below use your current
            settings.
          </Notice>
        )}

        {notice}

        <section
          aria-labelledby="checks-title"
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="checks-title" className="font-display text-xl">
              Checked by code
            </h2>
            <p className="text-xs text-muted">
              Not by the AI. Updates as you change people or protein.
            </p>
          </div>
          <Checks lines={checks} />
          <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">People</span>
              <Stepper
                compact
                label="People at the table"
                value={session.prefs.servings}
                min={PREF_LIMITS.servings.min}
                max={PREF_LIMITS.servings.max}
                onChange={(servings) => onPrefs({ servings })}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Protein target</span>
              <Stepper
                compact
                label="Protein target in grams per person per day"
                value={session.prefs.proteinTarget}
                unit="g"
                min={PREF_LIMITS.proteinTarget.min}
                max={PREF_LIMITS.proteinTarget.max}
                step={PREF_LIMITS.proteinTarget.step}
                onChange={(proteinTarget) => onPrefs({ proteinTarget })}
              />
            </div>
          </div>
        </section>

        <section aria-labelledby="days-title" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <h2 id="days-title" className="font-display text-2xl">
              The week
            </h2>
            <ul
              className="flex flex-wrap gap-x-3 text-xs text-muted"
              aria-label="Energy bar legend"
            >
              {[
                ["Protein", "bg-accent"],
                ["Carbs", "bg-wheat"],
                ["Fat", "bg-clay"],
              ].map(([name, color]) => (
                <li key={name} className="inline-flex items-center gap-1">
                  <span
                    className={`inline-block size-2.5 rounded-xs ${color}`}
                    aria-hidden="true"
                  />
                  {name}
                </li>
              ))}
              <li className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-0.5 bg-fg" aria-hidden="true" />
                Target
              </li>
            </ul>
          </div>
          <ol className="grid gap-3 md:grid-cols-2">
            {report.days.map((day) => {
              const entry = plan.days.find((d) => d.day === day.day);
              return (
                <li
                  key={day.day}
                  className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
                >
                  <h3 className="font-display text-xl leading-none">Day {day.day}</h3>
                  <ProteinBar
                    protein={day.macros.protein}
                    target={session.prefs.proteinTarget}
                    scale={scale}
                    ok={day.proteinOk}
                  />
                  <EnergySplit macros={day.macros} />
                  <ul className="flex flex-col border-t border-border">
                    {entry?.meals.map((meal) => {
                      const recipe = plan.recipes.find((r) => r.id === meal.recipeId);
                      if (!recipe) return null;
                      const leftover = cookedOn.get(`${day.day}:${meal.slot}`) !== day.day;
                      const current = shownId === recipe.id;
                      return (
                        <li key={meal.slot} className="border-b border-border last:border-b-0">
                          <button
                            type="button"
                            onClick={() => setSelected(recipe.id)}
                            aria-current={current ? "true" : undefined}
                            className={`grid w-full grid-cols-[4.75rem_minmax(0,1fr)] items-baseline gap-x-2 py-2 text-left text-sm hover:text-accent ${
                              current ? "lg:text-accent" : ""
                            }`}
                          >
                            <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
                              {SLOT_TEXT[meal.slot]}
                            </span>
                            <span className="min-w-0">
                              <span className="font-medium">{recipe.title}</span>
                              <span className="num ml-2 whitespace-nowrap text-xs text-muted">
                                {leftover ? "leftovers" : `${recipe.minutes} min`}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
            {average && (
              <li className="flex min-w-0 flex-col gap-3 rounded-lg border border-dashed border-border p-4">
                <h3 className="font-display text-xl leading-none">An average day</h3>
                <p className="text-sm">
                  <span className="num text-lg font-semibold">{whole(average.protein)}</span>{" "}
                  <span className="text-muted">g protein per person</span>
                </p>
                <EnergySplit macros={average} />
                <p className="text-xs text-muted">
                  The mean of the seven days above. Each day is one serving of each of its three
                  meals, added up from <span className="num">{report.coverage.counted}</span>{" "}
                  ingredient lines.
                </p>
              </li>
            )}
          </ol>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={onGroceries} className={button.primary}>
            Open the grocery list
            <ArrowIcon />
          </button>
          <p className="text-xs text-muted">Needed minus what you have, by aisle.</p>
        </div>

        {session.planMeta && (
          <section
            aria-label="About this plan"
            className="flex flex-col gap-1 border-t border-border pt-4 text-xs text-muted"
          >
            <p className="font-semibold text-fg">{sourceLabel(session.planMeta, "plan")}</p>
            <p className="max-w-prose">{sourceNote(session.planMeta, "plan")}</p>
            {!session.planMeta.placeholder && <CostMeter meta={session.planMeta} />}
          </section>
        )}
      </div>

      <aside
        aria-label="Recipe"
        className={`min-w-0 lg:sticky lg:top-16 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:rounded-lg lg:border lg:border-border lg:bg-surface lg:p-5 ${
          selected ? "" : "hidden lg:block"
        }`}
      >
        {shown && (
          <RecipeCard
            key={shown.id}
            recipe={shown}
            portions={portionsFor(plan, shown.id, session.prefs, session.portions)}
            defaultPortions={portionsFor(plan, shown.id, session.prefs)}
            people={session.prefs.servings}
            events={events.filter((event) => event.recipeId === shown.id)}
            onHand={onHand}
            headingRef={recipeHeading}
            onPortions={(portions) => onPortions(shown.id, portions)}
            onBack={selected ? () => setSelected(null) : undefined}
          />
        )}
      </aside>
    </div>
  );
}
