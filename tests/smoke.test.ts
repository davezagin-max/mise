/**
 * The main path, end to end, in demo mode: tap a sample fridge, confirm the
 * ingredients, get a week, read the grocery list. It goes through the real
 * route handlers with no API key, exactly as a first-time visitor does.
 */
import { describe, expect, it } from "vitest";
import { POST as planRoute } from "@/app/api/plan/route";
import { POST as scanRoute } from "@/app/api/scan/route";
import planStore from "@/fixtures/plan.json";
import scanStore from "@/fixtures/scan.json";
import type { ApiResponse } from "@/lib/api";
import { buildGroceryList } from "@/lib/grocery";
import { checkPlan } from "@/lib/plan/check";
import type { PlanData } from "@/lib/plan/schema";
import { SAMPLES } from "@/lib/samples";
import type { ScanResult } from "@/lib/types";

let caller = 0;
/** Each request comes from its own address so the rate limiter stays out of the way. */
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++caller}`, ...headers },
    body: JSON.stringify(body),
  });

describe.each(SAMPLES)("demo mode: $id", (sample) => {
  it("scans the sample, plans the week and builds the grocery list", async () => {
    const scanRes = await scanRoute(post("/api/scan", { demoId: sample.id, sampleId: sample.id }));
    const scan = (await scanRes.json()) as ApiResponse<ScanResult>;
    expect(scanRes.status).toBe(200);
    if (!scan.ok) throw new Error(scan.error.message);
    expect(scan.meta.mode).toBe("demo");
    // The UI's wording follows this flag, so it must be the fixture's own.
    expect(scan.meta.placeholder).toBe(scanStore[sample.id].placeholder);
    expect(scan.data.items.length).toBeGreaterThan(5);

    const ingredients = scan.data.items.map(({ name, quantity, unit }) => ({
      name,
      quantity,
      unit,
    }));
    const planRes = await planRoute(
      post("/api/plan", { demoId: sample.id, ingredients, prefs: sample.prefs }),
    );
    const planned = (await planRes.json()) as ApiResponse<PlanData>;
    expect(planRes.status).toBe(200);
    if (!planned.ok) throw new Error(planned.error.message);
    expect(planned.meta.placeholder).toBe(planStore[sample.id].placeholder);

    const { plan } = planned.data;
    expect(plan.days).toHaveLength(7);
    expect(plan.days.every((day) => day.meals.length === 3)).toBe(true);

    const report = checkPlan(plan, sample.prefs, scan.data.items);
    expect(report.errors).toEqual([]);
    expect(report.days.map((day) => day.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(report.days.every((day) => day.macros.protein > 40)).toBe(true);

    const list = buildGroceryList(plan, sample.prefs, scan.data.items);
    expect(list.groups.length).toBeGreaterThan(2);
    expect(list.groups[0].aisle).toBe("produce");
  });
});

describe("demo mode: edges", () => {
  const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, ...Array(20).fill(0)));

  it("explains that a visitor's own photo needs a key", async () => {
    const res = await scanRoute(post("/api/scan", { image: { mediaType: "image/jpeg", data: jpeg } }));
    const json = (await res.json()) as ApiResponse<ScanResult>;
    expect(res.status).toBe(404);
    expect(json.ok === false && json.error.kind).toBe("demo_miss");
  });

  it("explains that a plan without a preset needs a key", async () => {
    const res = await planRoute(
      post("/api/plan", {
        ingredients: [{ name: "eggs", quantity: 6, unit: "each" }],
        prefs: SAMPLES[0].prefs,
      }),
    );
    const json = (await res.json()) as ApiResponse<PlanData>;
    expect(res.status).toBe(404);
    expect(json.ok === false && json.error.message).toContain("add your Anthropic key");
  });

  it("rejects malformed requests before anything else happens", async () => {
    const both = { sampleId: "weeknight", image: { mediaType: "image/jpeg", data: jpeg } };
    expect((await scanRoute(post("/api/scan", both))).status).toBe(400);
    expect((await scanRoute(post("/api/scan", { sampleId: "nope" }))).status).toBe(400);
    expect((await planRoute(post("/api/plan", { ingredients: [] }))).status).toBe(400);
  });

  it("rejects a malformed key without echoing it", async () => {
    const res = await scanRoute(
      post("/api/scan", { sampleId: "weeknight" }, { "x-anthropic-key": "hunter2-not-a-key" }),
    );
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("hunter2");
  });
});
