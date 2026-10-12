/**
 * The visitor's session: ingredient list, preferences, plan, portion overrides
 * and grocery check-offs. It lives in `localStorage` so a reload at the shop,
 * or opening the installed app offline, shows the same week.
 *
 * State changes go through a pure reducer. The store around it reads storage
 * lazily on first use and writes only when an action is dispatched, so there is
 * no mount effect that could overwrite a saved session with defaults.
 *
 * Photos are never part of the session: nothing here stores image data.
 */
import { z } from "zod";
import type { ApiMeta } from "./api";
import { PlanBody, PlanWire, type PlanData } from "./plan/schema";
import { DEFAULT_PREFS, SAMPLE_IDS, sampleById, type SampleId } from "./samples";
import { CONFIDENCES, PREF_LIMITS, type Prefs, type ScanItem, type ScanResult } from "./types";

export const STORAGE_KEY = "mise.session.v1";

export const STEPS = ["fridge", "confirm", "week", "groceries"] as const;
export type Step = (typeof STEPS)[number];

/** A pantry row: a scan item with an id the list can key and edit by. */
export interface PantryEntry extends ScanItem {
  id: string;
  /** True once the visitor has edited or added the row. */
  edited: boolean;
}

export interface Session {
  step: Step;
  /** The sample fridge in use, or null for the visitor's own photo. */
  sampleId: SampleId | null;
  items: PantryEntry[];
  scanSummary: string;
  scanMeta: ApiMeta | null;
  prefs: Prefs;
  plan: PlanData | null;
  planMeta: ApiMeta | null;
  /** The diet and cook time the current plan was written for. */
  plannedFor: Pick<Prefs, "diet" | "maxMinutes"> | null;
  /** Portions per recipe set on a recipe card. */
  portions: Record<string, number>;
  /** Grocery items ticked off, by item key. */
  checked: Record<string, boolean>;
  /** Counter for row ids. */
  nextId: number;
}

export function defaultSession(): Session {
  return {
    step: "fridge",
    sampleId: null,
    items: [],
    scanSummary: "",
    scanMeta: null,
    prefs: DEFAULT_PREFS,
    plan: null,
    planMeta: null,
    plannedFor: null,
    portions: {},
    checked: {},
    nextId: 1,
  };
}

export type Action =
  | { type: "scanned"; sampleId: SampleId | null; result: ScanResult; meta: ApiMeta }
  | { type: "itemSaved"; id: string; item: Pick<ScanItem, "name" | "quantity" | "unit"> }
  | { type: "itemAdded"; item: Pick<ScanItem, "name" | "quantity" | "unit"> }
  | { type: "itemRemoved"; id: string }
  | { type: "prefsChanged"; prefs: Partial<Prefs> }
  | { type: "planned"; data: PlanData; meta: ApiMeta }
  | { type: "portionsSet"; recipeId: string; portions: number | null }
  | { type: "checkedSet"; key: string; checked: boolean }
  | { type: "checkedCleared" }
  | { type: "stepSet"; step: Step }
  | { type: "reset" };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cleanPrefs(prefs: Prefs): Prefs {
  const { servings, proteinTarget } = PREF_LIMITS;
  return {
    ...prefs,
    servings: clamp(Math.round(prefs.servings), servings.min, servings.max),
    proteinTarget: clamp(Math.round(prefs.proteinTarget), proteinTarget.min, proteinTarget.max),
  };
}

/** Whether a step can be shown with the session as it is. */
export function canVisit(session: Session, step: Step): boolean {
  if (step === "fridge") return true;
  if (step === "confirm") return session.items.length > 0 || session.scanMeta !== null;
  return session.plan !== null;
}

export function reduce(session: Session, action: Action): Session {
  switch (action.type) {
    case "scanned": {
      const sample = action.sampleId ? sampleById(action.sampleId) : null;
      let nextId = 1;
      const items = action.result.items.map((item) => ({
        ...item,
        id: `i${nextId++}`,
        edited: false,
      }));
      return {
        ...defaultSession(),
        step: "confirm",
        sampleId: action.sampleId,
        items,
        scanSummary: action.result.summary,
        scanMeta: action.meta,
        // A sample fridge comes with the preferences its plan was written for.
        prefs: sample ? sample.prefs : session.prefs,
        nextId,
      };
    }
    case "itemSaved":
      return {
        ...session,
        items: session.items.map((item) =>
          item.id === action.id
            ? { ...item, ...action.item, confidence: "high", note: "", edited: true }
            : item,
        ),
      };
    case "itemAdded":
      return {
        ...session,
        items: [
          ...session.items,
          {
            ...action.item,
            id: `i${session.nextId}`,
            confidence: "high",
            note: "",
            edited: true,
          },
        ],
        nextId: session.nextId + 1,
      };
    case "itemRemoved":
      return { ...session, items: session.items.filter((item) => item.id !== action.id) };
    case "prefsChanged":
      return { ...session, prefs: cleanPrefs({ ...session.prefs, ...action.prefs }) };
    case "planned":
      return {
        ...session,
        step: "week",
        plan: action.data,
        planMeta: action.meta,
        plannedFor: { diet: session.prefs.diet, maxMinutes: session.prefs.maxMinutes },
        portions: {},
        checked: {},
      };
    case "portionsSet": {
      const portions = { ...session.portions };
      if (action.portions === null) delete portions[action.recipeId];
      else portions[action.recipeId] = clamp(Math.round(action.portions), 1, 48);
      return { ...session, portions };
    }
    case "checkedSet": {
      const checked = { ...session.checked };
      if (action.checked) checked[action.key] = true;
      else delete checked[action.key];
      return { ...session, checked };
    }
    case "checkedCleared":
      return { ...session, checked: {} };
    case "stepSet":
      return canVisit(session, action.step) ? { ...session, step: action.step } : session;
    case "reset":
      return defaultSession();
  }
}

/** True when the plan on screen was written for a different diet or cook time. */
export function planIsStale(session: Session): boolean {
  const { plannedFor, prefs } = session;
  return (
    session.plan !== null &&
    plannedFor !== null &&
    (plannedFor.diet !== prefs.diet || plannedFor.maxMinutes !== prefs.maxMinutes)
  );
}

const Meta = z
  .object({
    mode: z.enum(["live", "demo"]),
    placeholder: z.boolean(),
    recordedAt: z.string().nullable(),
    model: z.string().nullable(),
    usage: z.object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_creation_input_tokens: z.number(),
      cache_read_input_tokens: z.number(),
    }),
    costUsd: z.number(),
  })
  .nullable();

const Stored = z.object({
  step: z.enum(STEPS),
  sampleId: z.enum(SAMPLE_IDS).nullable(),
  items: z
    .array(
      z.object({
        id: z.string().max(12),
        name: z.string().min(1).max(80),
        quantity: z.number().positive().max(10_000),
        unit: z.string().max(24),
        confidence: z.enum(CONFIDENCES),
        note: z.string().max(200),
        edited: z.boolean(),
      }),
    )
    .max(120),
  scanSummary: z.string().max(400),
  scanMeta: Meta,
  prefs: PlanBody.shape.prefs,
  plan: z
    .object({ plan: PlanWire, attempts: z.number(), revisedFor: z.array(z.string()) })
    .nullable(),
  planMeta: Meta,
  plannedFor: z
    .object({ diet: PlanBody.shape.prefs.shape.diet, maxMinutes: z.number() })
    .nullable(),
  portions: z.record(z.string(), z.number().positive().max(48)),
  checked: z.record(z.string(), z.boolean()),
  nextId: z.number().int().positive(),
});

/**
 * Reads a stored session. Anything that is not exactly the expected shape
 * (old version, hand-edited, corrupted) is discarded and the app starts fresh.
 */
export function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed = Stored.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const session = parsed.data as Session;
    // Never restore a step the data cannot support.
    return canVisit(session, session.step) ? session : { ...session, step: "fridge" };
  } catch {
    return null;
  }
}

/** The subset of the Web Storage API the store needs, so tests can pass a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SessionStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Session;
  getServerSnapshot(): Session;
  dispatch(action: Action): void;
}

const SERVER_SNAPSHOT = defaultSession();

export function createSessionStore(getStorage: () => KeyValueStore | null): SessionStore {
  let current: Session | null = null;
  const listeners = new Set<() => void>();

  function read(): Session {
    if (current) return current;
    let stored: Session | null = null;
    try {
      stored = parseSession(getStorage()?.getItem(STORAGE_KEY) ?? null);
    } catch {
      // Storage can be blocked. The session then lives in memory only.
    }
    current = stored ?? defaultSession();
    return current;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: read,
    getServerSnapshot: () => SERVER_SNAPSHOT,
    dispatch(action) {
      const next = reduce(read(), action);
      if (next === current) return;
      current = next;
      try {
        getStorage()?.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Full or blocked storage: keep going in memory.
      }
      listeners.forEach((listener) => listener());
    },
  };
}

/** The app's one store, backed by this browser's localStorage. */
export const sessionStore = createSessionStore(() =>
  typeof window === "undefined" ? null : window.localStorage,
);
