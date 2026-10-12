import { describe, expect, it } from "vitest";
import type { ApiMeta } from "@/lib/api";
import { ZERO_USAGE } from "@/lib/config";
import {
  STORAGE_KEY,
  canVisit,
  createSessionStore,
  defaultSession,
  parseSession,
  planIsStale,
  reduce,
  type KeyValueStore,
  type Session,
} from "@/lib/session";
import type { PlanData } from "@/lib/plan/schema";
import sample from "./pipeline/sample.json";

const meta: ApiMeta = {
  mode: "demo",
  placeholder: true,
  recordedAt: null,
  model: "claude-opus-5-5",
  usage: ZERO_USAGE,
  costUsd: 0,
};

const scan = {
  summary: "A fridge.",
  items: [
    { name: "eggs", quantity: 10, unit: "each", confidence: "high" as const, note: "" },
    { name: "milk", quantity: 6, unit: "cup", confidence: "medium" as const, note: "A guess." },
  ],
};
const planData = { plan: sample.plan, attempts: 1, revisedFor: [] } as PlanData;

/** In-memory stand-in for localStorage that counts writes. */
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  let writes = 0;
  const storage: KeyValueStore = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      writes += 1;
      data.set(key, value);
    },
  };
  return { storage, data, writes: () => writes };
}

const scanned = () =>
  reduce(defaultSession(), { type: "scanned", sampleId: "weeknight", result: scan, meta });
const planned = () => reduce(scanned(), { type: "planned", data: planData, meta });

describe("reduce", () => {
  it("loads a scan, moves to confirm and takes the sample's preferences", () => {
    const session = scanned();
    expect(session.step).toBe("confirm");
    expect(session.items.map((item) => item.id)).toEqual(["i1", "i2"]);
    expect(session.items[1]).toMatchObject({ name: "milk", confidence: "medium", edited: false });
    expect(session.prefs).toEqual({
      diet: "omnivore",
      maxMinutes: 30,
      servings: 2,
      proteinTarget: 110,
    });
  });

  it("a new scan starts a clean session but keeps the visitor's own preferences", () => {
    let session = planned();
    session = reduce(session, { type: "checkedSet", key: "egg", checked: true });
    session = reduce(session, { type: "prefsChanged", prefs: { servings: 4 } });
    const next = reduce(session, { type: "scanned", sampleId: null, result: scan, meta });
    expect(next.plan).toBeNull();
    expect(next.checked).toEqual({});
    expect(next.sampleId).toBeNull();
    expect(next.prefs.servings).toBe(4);
  });

  it("edits, adds and removes pantry rows", () => {
    let session = scanned();
    session = reduce(session, {
      type: "itemSaved",
      id: "i2",
      item: { name: "whole milk", quantity: 1, unit: "quart" },
    });
    expect(session.items[1]).toMatchObject({
      name: "whole milk",
      quantity: 1,
      unit: "quart",
      confidence: "high",
      note: "",
      edited: true,
    });
    session = reduce(session, {
      type: "itemAdded",
      item: { name: "tofu", quantity: 1, unit: "block" },
    });
    expect(session.items.at(-1)).toMatchObject({ id: "i3", name: "tofu", edited: true });
    session = reduce(session, { type: "itemRemoved", id: "i1" });
    expect(session.items.map((item) => item.id)).toEqual(["i2", "i3"]);
    // Ids are never reused, so React keys stay stable.
    session = reduce(session, {
      type: "itemAdded",
      item: { name: "feta", quantity: 100, unit: "g" },
    });
    expect(session.items.at(-1)?.id).toBe("i4");
  });

  it("keeps preferences inside their limits", () => {
    const session = reduce(scanned(), {
      type: "prefsChanged",
      prefs: { servings: 99, proteinTarget: 3 },
    });
    expect(session.prefs.servings).toBe(8);
    expect(session.prefs.proteinTarget).toBe(40);
  });

  it("stores a plan, remembers what it was written for, and flags it when that changes", () => {
    let session = planned();
    expect(session.step).toBe("week");
    expect(session.plannedFor).toEqual({ diet: "omnivore", maxMinutes: 30 });
    expect(planIsStale(session)).toBe(false);
    // People and protein are recomputed by code: the plan is still valid.
    session = reduce(session, { type: "prefsChanged", prefs: { servings: 4, proteinTarget: 150 } });
    expect(planIsStale(session)).toBe(false);
    session = reduce(session, { type: "prefsChanged", prefs: { diet: "vegan" } });
    expect(planIsStale(session)).toBe(true);
  });

  it("sets and clears portion overrides and grocery ticks", () => {
    let session = planned();
    session = reduce(session, { type: "portionsSet", recipeId: "a", portions: 6.4 });
    session = reduce(session, { type: "portionsSet", recipeId: "b", portions: 500 });
    expect(session.portions).toEqual({ a: 6, b: 48 });
    session = reduce(session, { type: "portionsSet", recipeId: "a", portions: null });
    expect(session.portions).toEqual({ b: 48 });

    session = reduce(session, { type: "checkedSet", key: "egg", checked: true });
    session = reduce(session, { type: "checkedSet", key: "milk-2", checked: true });
    session = reduce(session, { type: "checkedSet", key: "egg", checked: false });
    expect(session.checked).toEqual({ "milk-2": true });
    expect(reduce(session, { type: "checkedCleared" }).checked).toEqual({});
  });

  it("only moves to steps the data can support", () => {
    const empty = defaultSession();
    expect(canVisit(empty, "confirm")).toBe(false);
    expect(reduce(empty, { type: "stepSet", step: "week" })).toBe(empty);
    const session = scanned();
    expect(reduce(session, { type: "stepSet", step: "groceries" })).toBe(session);
    expect(reduce(planned(), { type: "stepSet", step: "groceries" }).step).toBe("groceries");
  });
});

describe("parseSession", () => {
  it("round-trips a full session", () => {
    const session = reduce(planned(), { type: "checkedSet", key: "egg", checked: true });
    expect(parseSession(JSON.stringify(session))).toEqual(session);
  });

  it("discards anything that is not a valid session", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession("not json")).toBeNull();
    expect(parseSession("{}")).toBeNull();
    const bad = { ...planned(), prefs: { diet: "carnivore" } };
    expect(parseSession(JSON.stringify(bad))).toBeNull();
    const huge = { ...scanned(), items: [{ ...scanned().items[0], quantity: -5 }] };
    expect(parseSession(JSON.stringify(huge))).toBeNull();
  });

  it("falls back to the first step when the saved step has no data behind it", () => {
    const broken: Session = { ...defaultSession(), step: "week" };
    expect(parseSession(JSON.stringify(broken))?.step).toBe("fridge");
  });
});

describe("session store", () => {
  it("survives a reload in the middle of a session", () => {
    const { storage } = memory();
    const first = createSessionStore(() => storage);
    first.dispatch({ type: "scanned", sampleId: "weeknight", result: scan, meta });
    first.dispatch({ type: "planned", data: planData, meta });
    first.dispatch({ type: "checkedSet", key: "egg", checked: true });
    first.dispatch({ type: "stepSet", step: "groceries" });

    // A reload: a brand-new store over the same storage.
    const second = createSessionStore(() => storage);
    expect(second.getSnapshot()).toEqual(first.getSnapshot());
    expect(second.getSnapshot().step).toBe("groceries");
    expect(second.getSnapshot().checked).toEqual({ egg: true });
    expect(second.getSnapshot().plan?.plan.recipes).toHaveLength(10);
  });

  it("never writes on read, so mounting cannot overwrite a saved session", () => {
    const saved = JSON.stringify(planned());
    const { storage, data, writes } = memory({ [STORAGE_KEY]: saved });
    const store = createSessionStore(() => storage);
    const unsubscribe = store.subscribe(() => {});
    store.getSnapshot();
    store.getSnapshot();
    unsubscribe();
    expect(writes()).toBe(0);
    expect(data.get(STORAGE_KEY)).toBe(saved);
    // The server snapshot is the empty default, whatever is stored.
    expect(store.getServerSnapshot().step).toBe("fridge");
    expect(store.getSnapshot().step).toBe("week");
  });

  it("returns the same snapshot object until something changes, then notifies", () => {
    const { storage, writes } = memory();
    const store = createSessionStore(() => storage);
    let calls = 0;
    store.subscribe(() => calls++);
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);
    // An action that changes nothing does not write or notify.
    store.dispatch({ type: "stepSet", step: "week" });
    expect(calls).toBe(0);
    expect(writes()).toBe(0);
    store.dispatch({ type: "prefsChanged", prefs: { servings: 3 } });
    expect(calls).toBe(1);
    expect(writes()).toBe(1);
    expect(store.getSnapshot()).not.toBe(before);
  });

  it("keeps working in memory when storage is blocked or corrupt", () => {
    const blocked = createSessionStore(() => {
      throw new Error("SecurityError");
    });
    blocked.dispatch({ type: "prefsChanged", prefs: { servings: 5 } });
    expect(blocked.getSnapshot().prefs.servings).toBe(5);

    const { storage } = memory({ [STORAGE_KEY]: "{{{corrupt" });
    expect(createSessionStore(() => storage).getSnapshot()).toEqual(defaultSession());
  });

  it("never stores image data", () => {
    const { storage, data } = memory();
    const store = createSessionStore(() => storage);
    store.dispatch({ type: "scanned", sampleId: null, result: scan, meta });
    expect(data.get(STORAGE_KEY)).not.toMatch(/base64|data:image|blob:/);
  });
});
