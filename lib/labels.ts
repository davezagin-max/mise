/**
 * Wording for where a result came from. Every label the UI shows about demo
 * output is derived from the response's own `placeholder` flag here, so a
 * hand-written sample can never be described as a model run, and the wording
 * changes by itself once real runs are recorded.
 */
import type { ApiMeta } from "./api";
import { MODELS } from "./config";

export type Kind = "scan" | "plan";
type Source = Pick<ApiMeta, "mode" | "placeholder" | "recordedAt" | "model">;

const NOUN: Record<Kind, string> = { scan: "ingredient list", plan: "plan" };

export function modelName(id: string | null): string {
  if (id === MODELS.opus) return "Claude Opus 5.5";
  if (id === MODELS.sonnet) return "Claude Sonnet 5.5";
  if (id === MODELS.haiku) return "Claude Haiku 5.5";
  return id ?? "Claude";
}

function day(iso: string | null): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(time) ? "" : new Date(time).toISOString().slice(0, 10);
}

/** A short tag: "Sample plan, written by hand". */
export function sourceLabel(meta: Source, kind: Kind): string {
  if (meta.mode === "live") return `Live ${NOUN[kind]} from ${modelName(meta.model)}`;
  if (meta.placeholder) return `Sample ${NOUN[kind]}, written by hand`;
  return `Recorded ${modelName(meta.model)} ${NOUN[kind]}`;
}

/** One sentence that says exactly what the visitor is looking at. */
export function sourceNote(meta: Source, kind: Kind): string {
  if (meta.mode === "live") {
    return `${modelName(meta.model)} produced this ${NOUN[kind]} just now with your key. Every number beside it is computed by the app.`;
  }
  if (meta.placeholder) {
    return `No model produced this ${NOUN[kind]}. It is a hand-written example, checked by the same code that checks a real one. Add a key to run it for real.`;
  }
  const date = day(meta.recordedAt);
  return `A real ${modelName(meta.model)} run${date ? `, recorded on ${date}` : ""}, replayed here. Add a key to run your own.`;
}

/** What a sample card promises before it is tapped. */
export function sampleHint(placeholder: boolean): string {
  return placeholder ? "Sample output, written by hand" : "Recorded Claude Opus 5.5 run";
}
