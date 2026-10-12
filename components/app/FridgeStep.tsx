"use client";

import Image from "next/image";
import type { ReactNode, RefObject } from "react";
import { sampleHint } from "@/lib/labels";
import { SAMPLES, type SampleId } from "@/lib/samples";
import { CameraIcon, Eyebrow, button } from "./ui";

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

const FACTS = [
  {
    title: "Claude reads the photo",
    body: "Opus 5.5 vision lists what it sees, estimates how much, and says how sure it is. You fix what it got wrong.",
  },
  {
    title: "Claude writes the week",
    body: "Seven days of meals from your diet, cook time, household size and protein target, using what spoils first.",
  },
  {
    title: "Code does the numbers",
    body: "Macros come from a nutrition table, not the model. The same code checks the diet and builds the grocery list.",
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

  return (
    <div className="flex flex-col gap-8 lg:gap-12">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
        <div className="flex flex-col gap-3 lg:gap-5 lg:pt-4">
          <Eyebrow>Fridge to meal plan</Eyebrow>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-[1.9rem] leading-[1.08] outline-none sm:text-5xl lg:text-[3.4rem]"
          >
            A week of meals from what is already in your fridge.
          </h1>
          <p className="max-w-prose text-sm text-muted sm:text-base">
            Photograph the fridge and get seven days of meals that use it up, with real macros and a
            grocery list for the gaps.
          </p>
        </div>

        <section aria-labelledby="samples-title" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="samples-title" className="text-sm font-semibold">
              Tap a sample fridge to try it
            </h2>
            <p className="text-xs text-muted">No key, no typing</p>
          </div>
          <ul className="grid grid-cols-3 gap-2 sm:gap-4">
            {SAMPLES.map((sample) => {
              const active = loading === sample.id;
              return (
                <li key={sample.id} className="min-w-0">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSample(sample.id)}
                    aria-describedby={`${sample.id}-hint`}
                    className="group flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-surface text-left transition-colors hover:border-accent disabled:cursor-wait"
                  >
                    <span className="relative block aspect-[4/5] w-full overflow-hidden bg-sunk">
                      <Image
                        src={sample.image}
                        alt={sample.alt}
                        width={1200}
                        height={1500}
                        sizes="(min-width: 1024px) 230px, 33vw"
                        priority
                        className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                      {active && (
                        <span className="absolute inset-0 overflow-hidden bg-bg/55">
                          <span className="sweep absolute inset-x-0 top-0 block h-full bg-linear-to-b from-transparent via-accent/35 to-transparent" />
                        </span>
                      )}
                    </span>
                    <span className="flex flex-1 flex-col gap-1 p-2 sm:p-3">
                      <span className="font-display text-[0.8125rem] leading-tight sm:text-lg">
                        {sample.title}
                      </span>
                      <span className="hidden text-xs text-muted sm:block">{sample.blurb}</span>
                      <span
                        id={`${sample.id}-hint`}
                        className="mt-auto pt-1 text-[0.625rem] leading-tight text-muted sm:text-[0.6875rem]"
                      >
                        {active
                          ? "Loading..."
                          : isLive
                            ? "Runs live with your key"
                            : sampleHint(flags[sample.id].scan || flags[sample.id].plan)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">
            The sample fridges are illustrations drawn for this demo, not photographs.
          </p>
        </section>
      </div>

      {notice}

      <section
        aria-labelledby="own-title"
        className="grid gap-4 rounded-lg border border-dashed border-border p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
      >
        <div className="flex flex-col gap-1">
          <h2 id="own-title" className="font-display text-xl">
            Or use your own fridge
          </h2>
          {isLive ? (
            <p className="max-w-prose text-sm text-muted">
              The photo is shrunk in your browser, sent to Claude for this one request, and not
              stored anywhere. Text in the photo is treated as something to read, never as an
              instruction.
            </p>
          ) : (
            <p className="max-w-prose text-sm text-muted">
              Reading your own photo is a real model call, so it needs an Anthropic key. The key
              stays in your browser. The sample fridges above work without one.
            </p>
          )}
        </div>
        {loading === "photo" ? (
          <div className="flex items-center gap-3">
            <p role="status" className="pulse-soft text-sm font-medium">
              Reading your photo...
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

      <section aria-label="How it works" className="grid gap-x-8 gap-y-5 sm:grid-cols-3">
        {FACTS.map((fact) => (
          <div key={fact.title} className="border-t-2 border-fg pt-3">
            <h2 className="font-display text-lg">{fact.title}</h2>
            <p className="mt-1 text-sm text-muted">{fact.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
