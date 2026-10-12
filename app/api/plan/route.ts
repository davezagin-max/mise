import fixtures from "@/fixtures/plan.json";
import { jsonRoute } from "@/lib/api";
import type { FixtureStore } from "@/lib/demo";
import { runPlan } from "@/lib/plan/run";
import { PlanBody, type PlanData } from "@/lib/plan/schema";

/** Two model calls in the worst case (a draft and one revision). */
export const maxDuration = 300;

export const POST = jsonRoute({
  store: "plan",
  fixtures: fixtures as unknown as FixtureStore<PlanData>,
  schema: PlanBody,
  rateLimit: { limit: 8, windowMs: 60_000 },
  live: ({ body, client, req }) =>
    runPlan({ client, pantry: body.ingredients, prefs: body.prefs, signal: req.signal }),
});
