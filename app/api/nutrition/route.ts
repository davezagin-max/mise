import { z } from "zod";
import { lookupFdc } from "@/lib/nutrition/fdc.mjs";
import type { NutritionResponseData } from "@/lib/nutrition/extra";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";

/**
 * Looks up ingredients the bundled table does not have in USDA FoodData
 * Central. Optional: without `USDA_API_KEY` on the server it answers
 * `available: false` and the app carries on with the bundled table alone.
 * No model is involved, so there is no demo fixture and no visitor key.
 */
const Body = z.object({ names: z.array(z.string().trim().min(1).max(80)).min(1).max(20) });

const limiter = createRateLimiter(10, 60_000);
const MAX_BYTES = 4096;

export async function POST(req: Request): Promise<Response> {
  const verdict = limiter(clientIp(req));
  if (!verdict.allowed) {
    return Response.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSeconds) } },
    );
  }
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "Too large." }, { status: 413 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(JSON.parse(raw));
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const apiKey = process.env.USDA_API_KEY;
  const result: NutritionResponseData = { available: Boolean(apiKey), foods: {} };
  if (!apiKey) return Response.json(result);

  await Promise.all(
    [...new Set(body.names)].map(async (name) => {
      try {
        result.foods[name] = await lookupFdc(name, { apiKey, signal: req.signal });
      } catch {
        // One failed lookup leaves that ingredient as "not in nutrition data".
        result.foods[name] = null;
      }
    }),
  );
  return Response.json(result);
}
