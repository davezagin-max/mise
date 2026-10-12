/**
 * The scan's wire format and the validator that runs after it.
 *
 * The wire schema is what Claude's structured output is constrained to. It
 * carries no numeric or length limits (the API rejects them), so every limit
 * is enforced here, in code, after parsing.
 */
import { z } from "zod";
import { normalizeName } from "../nutrition/match";
import { SAMPLE_IDS } from "../samples";
import { CONFIDENCES, type Confidence, type ScanItem, type ScanResult } from "../types";
import { parseUnit } from "../units";
import { MAX_IMAGE_BYTES, MEDIA_TYPES } from "./image";

/** Base64 is 4 characters per 3 bytes. */
export const MAX_BASE64 = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

/**
 * The `/api/scan` request: either a sample id (the server reads the
 * illustration itself) or one photo the browser has already downscaled.
 * Never both, never neither.
 */
export const ScanBody = z
  .object({
    demoId: z.string().max(64).optional(),
    sampleId: z.enum(SAMPLE_IDS).optional(),
    image: z
      .object({ mediaType: z.enum(MEDIA_TYPES), data: z.string().min(16).max(MAX_BASE64) })
      .optional(),
  })
  .refine((body) => Boolean(body.sampleId) !== Boolean(body.image));
export type ScanBodyData = z.infer<typeof ScanBody>;

export const ScanWire = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      unit: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
      note: z.string(),
    }),
  ),
  summary: z.string(),
});
export type ScanWireData = z.infer<typeof ScanWire>;

export const SCAN_LIMITS = { items: 60, name: 60, unit: 20, note: 120, summary: 240 } as const;
const MAX_QUANTITY = 10_000;

/** Collapses whitespace, strips control characters and cuts to length. */
export function cleanText(text: string, max: number): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

const RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

/**
 * Turns raw scan output into a list the rest of the app can rely on:
 * names cleaned, units canonical where known, impossible quantities replaced
 * by "1, low confidence" so the visitor is asked to fix them, duplicates merged.
 */
export function normalizeScan(raw: ScanWireData): ScanResult {
  const merged = new Map<string, ScanItem>();
  for (const entry of raw.items) {
    const name = cleanText(entry.name, SCAN_LIMITS.name).toLowerCase();
    if (!name) continue;
    const unit = parseUnit(entry.unit)?.id ?? cleanText(entry.unit, SCAN_LIMITS.unit).toLowerCase();
    const valid =
      Number.isFinite(entry.quantity) && entry.quantity > 0 && entry.quantity <= MAX_QUANTITY;
    let confidence: Confidence = CONFIDENCES.includes(entry.confidence) ? entry.confidence : "low";
    if (!valid) confidence = "low";
    const item: ScanItem = {
      name,
      quantity: valid ? Math.round(entry.quantity * 100) / 100 : 1,
      unit: valid ? unit : "each",
      confidence,
      note: valid
        ? cleanText(entry.note, SCAN_LIMITS.note)
        : "The amount could not be read. Please set it.",
    };
    const key = `${normalizeName(name) || name}|${item.unit}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity = Math.round((existing.quantity + item.quantity) * 100) / 100;
      if (RANK[item.confidence] > RANK[existing.confidence]) existing.confidence = item.confidence;
      if (!existing.note) existing.note = item.note;
    } else if (merged.size < SCAN_LIMITS.items) {
      merged.set(key, item);
    }
  }
  return { items: [...merged.values()], summary: cleanText(raw.summary, SCAN_LIMITS.summary) };
}
