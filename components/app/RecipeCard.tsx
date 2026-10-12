"use client";

import type { RefObject } from "react";
import { recipeNutrition, scaleRecipe, type Macros } from "@/lib/nutrition/macros";
import { describeEvents, type CookEvent } from "@/lib/plan/schedule";
import type { Recipe } from "@/lib/types";
import { FAILURE_TEXT, formatAmount, formatGrams } from "@/lib/units";
import { BackIcon, ClockIcon, Stepper, Tag, button } from "./ui";

const whole = (value: number) => Math.round(value).toLocaleString("en-US");

function FactRow({ label, value, sub }: { label: string; value: string; sub?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 border-t border-fg/25 py-1 ${sub ? "pl-4 text-muted" : "font-medium"}`}
    >
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

/** Per-serving figures laid out like the panel on a food packet. */
function NutritionPanel({
  perServing,
  batch,
  portions,
  counted,
  total,
}: {
  perServing: Macros;
  batch: Macros;
  portions: number;
  counted: number;
  total: number;
}) {
  return (
    <section
      aria-label="Nutrition per serving"
      className="rounded-md border-2 border-fg bg-surface p-3 text-sm"
    >
      <h3 className="font-display text-xl leading-none">Per serving</h3>
      <p className="mt-1 text-xs text-muted">Computed by the app from the nutrition table.</p>
      <div className="mt-2 flex items-end justify-between border-t-[6px] border-fg pt-1">
        <span className="font-semibold">Calories</span>
        <span className="num text-3xl font-semibold leading-none">{whole(perServing.kcal)}</span>
      </div>
      <dl className="mt-1 border-b border-fg/25">
        <FactRow label="Protein" value={`${whole(perServing.protein)} g`} />
        <FactRow label="Carbohydrate" value={`${whole(perServing.carbs)} g`} />
        <FactRow label="of which fibre" value={`${whole(perServing.fiber)} g`} sub />
        <FactRow label="Fat" value={`${whole(perServing.fat)} g`} />
      </dl>
      <p className="mt-2 text-xs text-muted">
        Whole batch of {portions}: {whole(batch.kcal)} kcal, {whole(batch.protein)} g protein.{" "}
        {counted === total
          ? `All ${total} ingredients counted.`
          : `${counted} of ${total} ingredients counted, so the real figures are a little higher.`}
      </p>
    </section>
  );
}

interface RecipeCardProps {
  recipe: Recipe;
  /** Portions currently shown (the default or the visitor's override). */
  portions: number;
  /** One portion per person per meal that uses this recipe. */
  defaultPortions: number;
  people: number;
  events: CookEvent[];
  /** Food ids the visitor has on hand. */
  onHand: Set<string>;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onPortions: (portions: number | null) => void;
  onBack?: () => void;
}

export function RecipeCard({
  recipe,
  portions,
  defaultPortions,
  people,
  events,
  onHand,
  headingRef,
  onPortions,
  onBack,
}: RecipeCardProps) {
  const scaled = scaleRecipe(recipe, portions);
  const facts = recipeNutrition(scaled);
  const meals = events.reduce((count, event) => count + event.meals.length, 0);
  const overridden = portions !== defaultPortions;

  return (
    <article className="flex flex-col gap-5">
      {onBack && (
        <button type="button" onClick={onBack} className={`${button.quiet} -ml-2 self-start lg:hidden`}>
          <BackIcon />
          Back to the week
        </button>
      )}

      <header className="flex flex-col gap-2">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-2xl leading-tight outline-none sm:text-3xl"
        >
          {recipe.title}
        </h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1">
            <ClockIcon />
            <span className="num">{recipe.minutes}</span> min
          </span>
          <span>{describeEvents(events)}</span>
        </p>
        {recipe.why && <p className="text-sm">{recipe.why}</p>}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-sunk px-3 py-2">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Portions to make</span>
          <span className="text-xs text-muted">
            {overridden ? (
              <button
                type="button"
                onClick={() => onPortions(null)}
                className="underline underline-offset-2 hover:text-fg"
              >
                Reset to {defaultPortions}
              </button>
            ) : (
              `${people} ${people === 1 ? "person" : "people"} x ${meals} ${meals === 1 ? "meal" : "meals"}`
            )}
          </span>
        </div>
        <Stepper
          compact
          label={`Portions of ${recipe.title}`}
          value={portions}
          min={1}
          max={48}
          onChange={onPortions}
        />
      </div>

      <NutritionPanel
        perServing={facts.perServing}
        batch={facts.total}
        portions={portions}
        counted={facts.counted}
        total={facts.lines.length}
      />

      <section aria-label="Ingredients">
        <h3 className="border-b-2 border-fg pb-1 font-display text-lg">Ingredients</h3>
        <ul>
          {scaled.ingredients.map((ingredient, index) => {
            const line = facts.lines[index];
            const has = line.status !== "unmatched" && onHand.has(line.food.id);
            return (
              <li
                key={`${ingredient.name}-${index}`}
                className="grid grid-cols-[5.25rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-border py-1.5 text-sm"
              >
                <span className="num font-semibold">
                  {formatAmount(ingredient.quantity, ingredient.unit)}
                </span>
                <span className="min-w-0">
                  <span className="first-letter:uppercase">{ingredient.name}</span>
                  {ingredient.prep && <span className="text-muted">, {ingredient.prep}</span>}
                  {line.status === "unmatched" && (
                    <span className="block text-xs text-warn">
                      Not in the nutrition data: left out of the totals.
                    </span>
                  )}
                  {line.status === "unconvertible" && (
                    <span className="block text-xs text-warn">
                      Left out of the totals: {FAILURE_TEXT[line.reason]}.
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {line.status === "ok" && line.via !== "mass" && (
                    <span className="num text-xs text-muted">{formatGrams(line.grams)}</span>
                  )}
                  {has && <Tag tone="good">On hand</Tag>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Method">
        <h3 className="border-b-2 border-fg pb-1 font-display text-lg">Method</h3>
        <ol className="mt-2 flex flex-col gap-2 text-sm">
          {recipe.steps.map((step, index) => (
            <li key={index} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
              <span className="num font-semibold text-accent">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
