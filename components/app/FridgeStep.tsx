"use client";

import Image from "next/image";
import type { ReactNode, RefObject } from "react";
import { originOf, sampleHint, samplesNote, scanNarration } from "@/lib/labels";
import { SAMPLES, SAMPLE_IDS, type SampleId } from "@/lib/samples";
import { ArrowIcon, CalendarIcon, CameraIcon, CalculatorIcon, button } from "./ui";

export type SampleFlags = Record<SampleId, { scan: boolean; plan: boolean }>;

interface FridgeStepProps {
  flags: SampleFlags;
  isLive: boolean;
  /** The sample being loaded, "photo" for an upload in flight, or null. */
  loading: SampleId | "photo" | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onSample: (id: SampleId) => void;
  onPhoto: (file: File) => void;
  onAddKey: () => void;
  onCancel: () => void;
  notice: ReactNode;
}

/** The whole idea in three plain steps, shown on the first screen. */
const HOW = [
  {
    icon: CameraIcon,
    title: "Claude reads the photo",
    body: "It lists each food and roughly how much. You fix any mistakes.",
  },
  {
    icon: CalendarIcon,
    title: "Claude plans the week",
    body: "Seven days of meals for your diet and cook time, using up what spoils first.",
  },
  {
    icon: CalculatorIcon,
    title: "Code does the math",
    body: "Nutrition and the grocery list are worked out from a food table. The AI never makes up a number.",
  },
];

export function FridgeStep({
  flags,
  isLive,
  loading,
  headingRef,
  onSample,
  onPhoto,
  onAddKey,
  onCancel,
  notice,
}: FridgeStepProps) {
  const busy = loading !== null;
  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onPhoto(file);
  };
  const placeholderFor = (id: SampleId) => flags[id].scan || flags[id].plan;
  const loadingSample = loading && loading !== "photo" ? loading : null;

  return (
    <div className="flex flex-col gap-10 lg:gap-14">
      <div className="grid items-start gap-x-12 gap-y-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr]">
        <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-1 lg:gap-4 lg:pt-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-[1.9rem] leading-[1.08] outline-none sm:text-5xl lg:text-[2.85rem]"
          >
            A week of meals from what is already in your fridge.
          </h1>
          <p className="max-w-prose text-[0.9375rem] text-muted sm:text-lg lg:text-[1.0625rem]">
            Photograph your fridge and get seven days of meals that use what you have, with
            nutrition computed by code (not guessed by AI) and a grocery list for what is missing.
          </p>
        </div>

        <section
          aria-labelledby="samples-title"
          className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <div className="flex flex-col gap-0.5">
            <h2 id="samples-title" className="font-display text-xl sm:text-2xl">
              Start here: pick a sample fridge
            </h2>
            <p className="text-sm text-muted">
              {isLive
                ? "Each tap is a live run on your key."
                : "One tap, no key, no typing. You will see what is in it, then the week."}
            </p>
          </div>
          <ul className="grid gap-2.5 sm:grid-cols-3 sm:gap-4">
            {SAMPLES.map((sample) => {
              const active = loading === sample.id;
              return (
                <li key={sample.id} className="min-w-0">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSample(sample.id)}
                    aria-describedby={`${sample.id}-hint`}
                    className={`group flex h-full w-full items-center gap-3 rounded-lg border bg-surface p-2 text-left transition-colors hover:border-accent disabled:cursor-wait sm:flex-col sm:items-stretch sm:gap-0 sm:overflow-hidden sm:p-0 ${
                      active ? "border-accent" : "border-border"
                    } ${busy && !active ? "opacity-60" : ""}`}
                  >
                    <span className="relative block aspect-[4/5] w-16 shrink-0 overflow-hidden rounded-md bg-sunk sm:w-full sm:rounded-none">
                      {/* Decorative here: the button is named by the title beside it. */}
                      <Image
                        src={sample.image}
                        alt=""
                        width={1200}
                        height={1500}
                        sizes="(min-width: 1024px) 230px, (min-width: 640px) 33vw, 64px"
                        priority
                        className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                      {active && (
                        <span className="absolute inset-0 overflow-hidden bg-bg/55">
                          <span className="sweep absolute inset-x-0 top-0 block h-full bg-linear-to-b from-transparent via-accent/35 to-transparent" />
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1 sm:p-3">
                      <span className="font-display text-base leading-tight sm:text-lg">
                        {sample.title}
                      </span>
                      <span className="text-xs text-muted sm:hidden">{sample.short}</span>
                      <span className="hidden text-xs text-muted sm:block sm:pb-2">
                        {sample.blurb}
                      </span>
                      <span id={`${sample.id}-hint`} className="sr-only">
                        {isLive ? "Runs live with your key" : sampleHint(placeholderFor(sample.id))}
                      </span>
                      <span
                        aria-hidden="true"
                        className="mt-auto hidden items-center justify-between gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-fg group-hover:opacity-90 sm:flex"
                      >
                        {active ? "Opening..." : "Try this fridge"}
                        <ArrowIcon width={16} height={16} />
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg sm:hidden"
                    >
                      <ArrowIcon />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {loadingSample ? (
            <p role="status" className="pulse-soft text-sm font-medium">
              {scanNarration(originOf(isLive, placeholderFor(loadingSample)))}
            </p>
          ) : (
            <p className="text-xs text-muted">
              {isLive
                ? "The sample fridges are drawn illustrations, not photos."
                : samplesNote(SAMPLE_IDS.map(placeholderFor))}
            </p>
          )}
        </section>

        <section
          aria-labelledby="how-title"
          className="flex flex-col gap-3 lg:col-start-1 lg:row-start-2"
        >
          <h2
            id="how-title"
            className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-muted"
          >
            How it works
          </h2>
          <ol className="flex flex-col gap-2.5">
            {HOW.map((item) => (
              <li key={item.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
                >
                  <item.icon />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold">{item.title}</span>
                  <span className="text-sm text-muted">{item.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {notice}

      <section
        aria-labelledby="own-title"
        className="grid gap-4 rounded-lg border border-dashed border-border p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
      >
        <div className="flex flex-col gap-1">
          <h2 id="own-title" className="font-display text-xl">
            Or use a photo of your own fridge
          </h2>
          {isLive ? (
            <p className="max-w-prose text-sm text-muted">
              The photo is shrunk in your browser, sent to Claude for this one request, and not
              stored anywhere. Text in the photo is treated as something to read, never as an
              instruction.
            </p>
          ) : (
            <p className="max-w-prose text-sm text-muted">
              Reading your own photo calls Claude, so it needs your Anthropic API key. The key stays
              in your browser. The sample fridges above work without one.
            </p>
          )}
        </div>
        {loading === "photo" ? (
          <div className="flex items-center gap-3">
            <p role="status" className="pulse-soft text-sm font-medium">
              {scanNarration("live")}
            </p>
            <button type="button" onClick={onCancel} className={button.secondary}>
              Cancel
            </button>
          </div>
        ) : isLive ? (
          <div className="flex flex-wrap gap-2">
            <label
              className={`${button.primary} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${busy ? "pointer-events-none opacity-50" : ""}`}
            >
              <CameraIcon />
              Take a photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={busy}
                className="sr-only"
                onChange={(event) => {
                  pick(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            <label
              className={`${button.secondary} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${busy ? "pointer-events-none opacity-50" : ""}`}
            >
              Choose a photo
              <input
                type="file"
                accept="image/*"
                disabled={busy}
                className="sr-only"
                onChange={(event) => {
                  pick(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
        ) : (
          <button type="button" onClick={onAddKey} className={button.secondary}>
            <CameraIcon />
            Add a key to use your photo
          </button>
        )}
      </section>
    </div>
  );
}
