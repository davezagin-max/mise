"use client";

import { useState, type RefObject } from "react";
import { groceryText, type GroceryItem, type GroceryList } from "@/lib/grocery";
import type { PlanReport } from "@/lib/plan/check";
import { AlertIcon, Eyebrow, Tag, button } from "./ui";

function ItemRow({
  item,
  checked,
  onToggle,
}: {
  item: GroceryItem;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const later = item.note?.includes("later") ?? false;
  return (
    <li className="border-b border-border last:border-b-0">
      <label className="grid cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-3 py-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
          className="mt-0.5 size-5 accent-(--accent)"
        />
        <span className={`min-w-0 ${checked ? "text-muted line-through" : ""}`}>
          <span className="font-medium">{item.name}</span>
          {item.detail && <span className="block text-xs text-muted">{item.detail}</span>}
          {item.note && (
            <span
              className={`mt-0.5 flex items-start gap-1 text-xs no-underline ${later ? "text-warn" : "text-muted"}`}
            >
              {later && <AlertIcon width={14} height={14} className="mt-px shrink-0" />}
              {item.note}
            </span>
          )}
        </span>
        <span className={`num text-right text-sm font-semibold ${checked ? "text-muted" : ""}`}>
          {item.amount}
        </span>
      </label>
    </li>
  );
}

interface GroceryStepProps {
  list: GroceryList;
  report: PlanReport;
  checked: Record<string, boolean>;
  people: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onToggle: (key: string, checked: boolean) => void;
  onClear: () => void;
  onWeek: () => void;
}

export function GroceryStep({
  list,
  report,
  checked,
  people,
  headingRef,
  onToggle,
  onClear,
  onWeek,
}: GroceryStepProps) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const toBuy = list.groups.flatMap((group) => group.items);
  const done = toBuy.filter((item) => checked[item.key]).length;
  const anyChecked = Object.keys(checked).length > 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(groceryText(list));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-10">
      <div className="flex min-w-0 flex-col gap-6">
        <header className="flex flex-col gap-2">
          <Eyebrow>Needed minus on hand</Eyebrow>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-3xl leading-tight outline-none sm:text-5xl"
          >
            Grocery list
          </h1>
          <p className="max-w-prose text-sm sm:text-base">
            For {people} {people === 1 ? "person" : "people"}, seven days. Every amount is the
            plan&apos;s total in grams minus what the fridge already holds, rounded up to something
            a shop sells.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm" aria-live="polite">
              <span className="num font-semibold">{done}</span> of{" "}
              <span className="num font-semibold">{toBuy.length}</span> in the basket
            </p>
            <button type="button" onClick={copy} className={button.secondary}>
              {copied === "done" ? "Copied" : "Copy as text"}
            </button>
            {anyChecked && (
              <button type="button" onClick={onClear} className={button.quiet}>
                Untick everything
              </button>
            )}
            {copied === "failed" && (
              <span role="status" className="text-xs text-danger">
                Copying is blocked in this browser.
              </span>
            )}
          </div>
        </header>

        {list.groups.map((group) => (
          <section key={group.aisle} aria-labelledby={`aisle-${group.aisle}`}>
            <h2
              id={`aisle-${group.aisle}`}
              className="flex items-baseline justify-between border-b-2 border-fg pb-1 font-display text-xl"
            >
              {group.label}
              <span className="num font-sans text-xs font-normal text-muted">
                {group.items.length}
              </span>
            </h2>
            <ul>
              {group.items.map((item) => (
                <ItemRow
                  key={item.key}
                  item={item}
                  checked={Boolean(checked[item.key])}
                  onToggle={(value) => onToggle(item.key, value)}
                />
              ))}
            </ul>
          </section>
        ))}

        {list.check.length > 0 && (
          <section aria-labelledby="check-title">
            <h2 id="check-title" className="border-b-2 border-fg pb-1 font-display text-xl">
              Look before you shop
            </h2>
            <p className="mt-2 text-xs text-muted">
              You have these, but in an amount the app cannot turn into grams, so it will not
              pretend to subtract them.
            </p>
            <ul>
              {list.check.map((item) => (
                <ItemRow
                  key={item.key}
                  item={item}
                  checked={Boolean(checked[item.key])}
                  onToggle={(value) => onToggle(item.key, value)}
                />
              ))}
            </ul>
          </section>
        )}

        {list.staples.length > 0 && (
          <section aria-labelledby="staples-title">
            <h2 id="staples-title" className="border-b-2 border-fg pb-1 font-display text-xl">
              Pantry staples
            </h2>
            <p className="mt-2 text-xs text-muted">
              Oil, salt, spices and the like. The plan uses these amounts; most kitchens have them.
            </p>
            <ul className="grid gap-x-8 sm:grid-cols-2">
              {list.staples.map((item) => (
                <ItemRow
                  key={item.key}
                  item={{ ...item, detail: "" }}
                  checked={Boolean(checked[item.key])}
                  onToggle={(value) => onToggle(item.key, value)}
                />
              ))}
            </ul>
          </section>
        )}

        <button type="button" onClick={onWeek} className={`${button.secondary} self-start`}>
          Back to the week
        </button>
      </div>

      <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-16">
        {report.perishables.length > 0 && (
          <section
            aria-labelledby="first-title"
            className="rounded-lg border border-border bg-surface p-4"
          >
            <h2 id="first-title" className="font-display text-xl">
              Use these first
            </h2>
            <p className="mt-1 text-xs text-muted">
              Fresh food you already have, most urgent first, with the day the plan cooks it.
              Shelf life is a typical figure and assumes the food is fresh today.
            </p>
            <ol className="mt-3 flex flex-col">
              {report.perishables.map((use) => (
                <li
                  key={use.foodId}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-t border-border py-1.5 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{use.name}</span>
                    <span className="block text-xs text-muted">
                      keeps about <span className="num">{use.keeps}</span>{" "}
                      {use.keeps === 1 ? "day" : "days"}
                    </span>
                  </span>
                  {use.status === "ok" ? (
                    <Tag tone="good">Day {use.firstDay}</Tag>
                  ) : use.status === "late" ? (
                    <Tag tone="warn">Day {use.firstDay}: late</Tag>
                  ) : (
                    <Tag tone="warn">Not used</Tag>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {list.covered.length > 0 && (
          <details className="rounded-lg border border-border bg-surface p-4">
            <summary className="cursor-pointer font-display text-xl">
              Already covered
              <span className="num ml-2 font-sans text-xs font-normal text-muted">
                {list.covered.length}
              </span>
            </summary>
            <p className="mt-1 text-xs text-muted">
              The plan needs these and the fridge has enough.
            </p>
            <ul className="mt-2">
              {list.covered.map((item) => (
                <li
                  key={item.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-t border-border py-1.5 text-sm"
                >
                  <span className="min-w-0">
                    {item.name}
                    <span className="block text-xs text-muted">{item.detail}</span>
                  </span>
                  <span className="num text-xs text-muted">needs {item.amount}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </aside>
    </div>
  );
}
