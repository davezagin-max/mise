"use client";

import Image from "next/image";
import { useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { CostMeter } from "@/components/kit/CostMeter";
import { originOf, planNarration, sourceLabel, sourceNote } from "@/lib/labels";
import { resolve } from "@/lib/nutrition/macros";
import { sampleById } from "@/lib/samples";
import type { PantryEntry, Session } from "@/lib/session";
import {
  COOK_TIMES,
  DIETS,
  PREF_LIMITS,
  type Confidence,
  type Prefs,
  type Quantity,
} from "@/lib/types";
import { FAILURE_TEXT, formatAmount, formatGrams } from "@/lib/units";
import { ArrowIcon, CloseIcon, Eyebrow, PlusIcon, Stepper, Tag, button } from "./ui";

const UNIT_OPTIONS = [
  "each",
  "g",
  "kg",
  "oz",
  "lb",
  "ml",
  "cup",
  "tbsp",
  "tsp",
  "clove",
  "head",
  "bunch",
  "stalk",
  "slice",
  "can",
  "jar",
  "package",
  "block",
  "stick",
  "fillet",
  "container",
];

const CONFIDENCE: Record<Confidence, { text: string; tone: "good" | "warn" | "bad" }> = {
  high: { text: "Sure", tone: "good" },
  medium: { text: "Likely", tone: "warn" },
  low: { text: "Guess", tone: "bad" },
};

const field =
  "min-h-11 w-full min-w-0 rounded-md border border-border bg-bg px-3 py-2 text-base sm:text-sm";

/** What the nutrition data makes of one pantry row, when that adds anything to the row itself. */
function matchLine(item: Quantity): { text: string; known: boolean } | null {
  const resolved = resolve(item);
  if (resolved.status === "unmatched") {
    return {
      text: "Not in the nutrition data: it will not count toward the nutrition totals.",
      known: false,
    };
  }
  if (resolved.status === "unconvertible") {
    return {
      text: `${resolved.food.name}, but ${FAILURE_TEXT[resolved.reason]}. Give a weight to compare it with the plan.`,
      known: false,
    };
  }
  const renamed = resolved.food.name.toLowerCase() !== item.name.toLowerCase();
  const parts = [
    renamed ? `Counted as ${resolved.food.name}` : "",
    resolved.via === "mass" ? "" : `about ${formatGrams(resolved.grams)}`,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const text = parts.join(", ");
  return { text: text.charAt(0).toUpperCase() + text.slice(1), known: true };
}

function ItemForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Quantity;
  submitLabel: string;
  onSubmit: (item: Quantity) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [quantity, setQuantity] = useState(String(initial.quantity));
  const [unit, setUnit] = useState(initial.unit || "each");
  const amount = Number(quantity);
  const valid = name.trim().length > 0 && Number.isFinite(amount) && amount > 0 && amount <= 10_000;
  const units = UNIT_OPTIONS.includes(unit) ? UNIT_OPTIONS : [unit, ...UNIT_OPTIONS];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onSubmit({ name: name.trim().toLowerCase(), quantity: amount, unit });
    if (!onCancel) {
      setName("");
      setQuantity("1");
      setUnit("each");
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
      <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted">
        Food
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          placeholder="e.g. red lentils"
          autoComplete="off"
          className={`${field} text-fg`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Amount
        <input
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          inputMode="decimal"
          className={`${field} num text-fg`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Unit
        <select
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          className={`${field} text-fg`}
        >
          {units.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <div className="col-span-2 flex flex-wrap justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className={button.quiet}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={!valid} className={button.secondary}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function Row({
  item,
  onSave,
  onRemove,
}: {
  item: PantryEntry;
  onSave: (item: Quantity) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const match = matchLine(item);
  const confidence = CONFIDENCE[item.confidence];

  if (editing) {
    return (
      <li className="rounded-md border border-accent bg-surface p-3">
        <ItemForm
          initial={item}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={(next) => {
            onSave(next);
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-surface py-2 pl-3 pr-1">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium first-letter:uppercase">{item.name}</span>
          <span className="num text-sm text-muted">{formatAmount(item.quantity, item.unit)}</span>
          {item.edited ? (
            <Tag title="You set this row">Yours</Tag>
          ) : (
            <Tag tone={confidence.tone} title={`Scan confidence: ${item.confidence}`}>
              {confidence.text}
            </Tag>
          )}
        </div>
        {match && (
          <p className={`text-xs ${match.known ? "text-muted" : "text-warn"}`}>{match.text}</p>
        )}
        {item.note && <p className="text-xs text-muted">{item.note}</p>}
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`${button.quiet} shrink-0`}
        aria-label={`Edit ${item.name}`}
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:text-danger"
        aria-label={`Remove ${item.name}`}
      >
        <CloseIcon />
      </button>
    </li>
  );
}

const DIET_TEXT: Record<Prefs["diet"], string> = {
  omnivore: "Omnivore",
  pescatarian: "Pescatarian",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
};

function Choice<T extends string | number>({
  legend,
  name,
  options,
  value,
  disabled,
  onChange,
  columns,
}: {
  legend: string;
  name: string;
  options: { value: T; label: string }[];
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
  columns: string;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      <div className={`grid gap-2 ${columns}`}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={String(option.value)}
              className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-center text-sm font-medium has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${
                selected
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-border bg-surface hover:border-fg/40"
              } ${disabled && !selected ? "cursor-not-allowed opacity-45" : ""} ${disabled ? "cursor-not-allowed" : ""}`}
            >
              <input
                type="radio"
                name={name}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PrefsForm({
  prefs,
  locked,
  onChange,
}: {
  prefs: Prefs;
  /** Diet and cook time cannot change (demo mode: they shape the plan itself). */
  locked: boolean;
  onChange: (prefs: Partial<Prefs>) => void;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Choice
        legend="Diet"
        name="diet"
        columns="grid-cols-2"
        disabled={locked}
        value={prefs.diet}
        onChange={(diet) => onChange({ diet })}
        options={DIETS.map((diet) => ({ value: diet, label: DIET_TEXT[diet] }))}
      />
      <Choice
        legend="Longest cook time"
        name="minutes"
        columns="grid-cols-4 sm:grid-cols-2"
        disabled={locked}
        value={prefs.maxMinutes}
        onChange={(maxMinutes) => onChange({ maxMinutes })}
        options={[...new Set([...COOK_TIMES, prefs.maxMinutes])]
          .sort((a, b) => a - b)
          .map((minutes) => ({ value: minutes, label: `${minutes} min` }))}
      />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">People at the table</p>
        <Stepper
          label="People at the table"
          value={prefs.servings}
          min={PREF_LIMITS.servings.min}
          max={PREF_LIMITS.servings.max}
          onChange={(servings) => onChange({ servings })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Protein per person, per day</p>
        <Stepper
          label="Protein target in grams per person per day"
          value={prefs.proteinTarget}
          unit="g"
          min={PREF_LIMITS.proteinTarget.min}
          max={PREF_LIMITS.proteinTarget.max}
          step={PREF_LIMITS.proteinTarget.step}
          onChange={(proteinTarget) => onChange({ proteinTarget })}
        />
      </div>
      {locked && (
        <p className="text-xs text-muted sm:col-span-2">
          Diet and cook time shape the plan itself, so changing them needs a key. People and protein
          are recomputed by code and work in the demo.
        </p>
      )}
    </div>
  );
}

interface ConfirmStepProps {
  session: Session;
  isLive: boolean;
  /** The visitor's own photo, held in memory for this tab only. */
  photoUrl: string | null;
  planning: boolean;
  /** Whether the plan this fridge would load in demo mode is a hand-written sample. */
  planIsPlaceholder: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  notice: ReactNode;
  onSave: (id: string, item: Quantity) => void;
  onAdd: (item: Quantity) => void;
  onRemove: (id: string) => void;
  onPrefs: (prefs: Partial<Prefs>) => void;
  onPlan: () => void;
  onCancel: () => void;
}

export function ConfirmStep({
  session,
  isLive,
  photoUrl,
  planning,
  planIsPlaceholder,
  headingRef,
  notice,
  onSave,
  onAdd,
  onRemove,
  onPrefs,
  onPlan,
  onCancel,
}: ConfirmStepProps) {
  const [adding, setAdding] = useState(false);
  const sample = session.sampleId ? sampleById(session.sampleId) : null;
  const unsure = session.items.filter((item) => !item.edited && item.confidence !== "high").length;
  const demoSample = !isLive && sample !== null;

  const cta = (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
      {planning ? (
        <div className="flex items-center gap-3">
          <p role="status" className="pulse-soft text-sm font-medium">
            {planNarration(originOf(isLive, planIsPlaceholder))}
          </p>
          <button type="button" onClick={onCancel} className={`${button.secondary} shrink-0`}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPlan}
          disabled={session.items.length === 0}
          className={`${button.primary} w-full lg:w-auto lg:px-6`}
        >
          Plan my week
          <ArrowIcon />
        </button>
      )}
      {!planning && (
        <p className="text-xs text-muted">
          {isLive
            ? "One Claude Opus 5.5 call, usually under a minute. A second call only if the app's checks send the draft back."
            : demoSample
              ? planIsPlaceholder
                ? "Demo: opens the sample plan for this fridge."
                : "Demo: replays the recorded plan for this fridge."
              : "A plan from your own list needs an Anthropic key."}
        </p>
      )}
    </div>
  );

  const picture = (shape: string) =>
    sample ? (
      <Image
        src={sample.image}
        alt={sample.alt}
        width={1200}
        height={1500}
        sizes="(min-width: 1024px) 320px, 100vw"
        className={`w-full object-cover ${shape}`}
      />
    ) : photoUrl ? (
      // A blob URL of the visitor's own photo: there is nothing for the image optimiser to fetch.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photoUrl} alt="Your fridge photo" className={`w-full object-cover ${shape}`} />
    ) : (
      <p className={`flex items-center justify-center p-6 text-center text-sm text-muted ${shape}`}>
        Your photo is not kept after a reload. The ingredient list is.
      </p>
    );
  const source = session.scanMeta && (
    <div className="flex flex-col gap-1.5 text-xs text-muted">
      <p className="font-semibold text-fg">{sourceLabel(session.scanMeta, "scan")}</p>
      <p>{sourceNote(session.scanMeta, "scan")}</p>
      {/* A hand-written sample cost nothing, so there is no meter to show. */}
      {!session.scanMeta.placeholder && <CostMeter meta={session.scanMeta} />}
    </div>
  );

  return (
    <div className="grid items-start gap-6 pb-28 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-10">
      <aside className="hidden flex-col gap-3 lg:sticky lg:top-16 lg:flex">
        <div className="overflow-hidden rounded-lg border border-border bg-sunk">
          {picture("aspect-[4/5] object-top")}
        </div>
        {source}
      </aside>

      <div className="flex min-w-0 flex-col gap-8">
        <section aria-labelledby="confirm-title" className="flex flex-col gap-3">
          <Eyebrow>Step 2 of 4 · Check the list</Eyebrow>
          <h1
            ref={headingRef}
            id="confirm-title"
            tabIndex={-1}
            className="font-display text-3xl leading-tight outline-none sm:text-4xl"
          >
            Is this what you have?
          </h1>
          {session.scanSummary && <p className="text-sm text-muted">{session.scanSummary}</p>}
          <div className="overflow-hidden rounded-lg border border-border bg-sunk lg:hidden">
            {picture("aspect-[2/1] object-[50%_24%]")}
          </div>
          <p className="text-sm">
            <span className="num font-semibold">{session.items.length}</span> foods found
            {unsure > 0 && (
              <>
                , <span className="num font-semibold">{unsure}</span> worth a second look
              </>
            )}
            . Fix anything that is wrong: the grocery list subtracts exactly what is here. The tag
            on each row says how sure the photo reading was.
          </p>

          {session.items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">
              No food was found. Add what you have below, or go back and try another photo.
            </div>
          ) : (
            <ul className="grid gap-2 xl:grid-cols-2">
              {session.items.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  onSave={(next) => onSave(item.id, next)}
                  onRemove={() => onRemove(item.id)}
                />
              ))}
            </ul>
          )}

          {adding ? (
            <div className="rounded-md border border-border bg-surface p-3">
              <ItemForm
                initial={{ name: "", quantity: 1, unit: "each" }}
                submitLabel="Add to the list"
                onSubmit={(item) => {
                  onAdd(item);
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={`${button.secondary} self-start`}
            >
              <PlusIcon />
              Add something the scan missed
            </button>
          )}
        </section>

        <section aria-labelledby="prefs-title" className="flex flex-col gap-4">
          <h2 id="prefs-title" className="border-t-2 border-fg pt-3 font-display text-2xl">
            How do you eat?
          </h2>
          <PrefsForm prefs={session.prefs} locked={!isLive} onChange={onPrefs} />
        </section>

        <div className="lg:hidden">{source}</div>

        {/*
          Pinned to the bottom of the screen at every size, so the next step never needs a scroll.
          A failed plan is reported here too, next to the button that was pressed.
        */}
        <div className="fixed inset-x-0 bottom-0 z-20 max-h-[70dvh] overflow-y-auto border-t border-border bg-bg py-3">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4">
            {notice}
            {cta}
          </div>
        </div>
      </div>
    </div>
  );
}
