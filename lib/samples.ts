/**
 * The three sample fridges offered on the first screen. Each id is also the
 * `demoId` its scan and plan fixtures are stored under.
 *
 * The pictures are illustrations drawn in code (`scripts/make-samples.mjs`),
 * not photographs. The definitions live in `samples.json` so the preset script
 * can read them without a TypeScript loader.
 */
import data from "./samples.json";
import type { Prefs } from "./types";

export const SAMPLE_IDS = ["weeknight", "garden", "catch"] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];

export interface Sample {
  id: SampleId;
  title: string;
  blurb: string;
  image: string;
  /** Describes the illustration for screen readers. */
  alt: string;
  prefs: Prefs;
}

export const SAMPLES = data as Sample[];

export function sampleById(id: string): Sample | null {
  return SAMPLES.find((sample) => sample.id === id) ?? null;
}

export const DEFAULT_PREFS: Prefs = {
  diet: "omnivore",
  maxMinutes: 30,
  servings: 2,
  proteinTarget: 100,
};
