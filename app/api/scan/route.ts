import fixtures from "@/fixtures/scan.json";
import { jsonRoute } from "@/lib/api";
import { PipelineError } from "@/lib/claude";
import type { FixtureStore } from "@/lib/demo";
import { checkImage } from "@/lib/scan/image";
import { runScan } from "@/lib/scan/run";
import { loadSampleImage } from "@/lib/scan/sample-image";
import { MAX_BASE64, ScanBody } from "@/lib/scan/schema";
import type { ScanResult } from "@/lib/types";

export const maxDuration = 60;

export const POST = jsonRoute({
  store: "scan",
  fixtures: fixtures as unknown as FixtureStore<ScanResult>,
  schema: ScanBody,
  maxBytes: MAX_BASE64 + 4096,
  rateLimit: { limit: 12, windowMs: 60_000 },
  live: async ({ body, client, req }) => {
    const image = body.image ?? (await loadSampleImage(body.sampleId ?? "weeknight"));
    const verdict = checkImage(image);
    if (!verdict.ok) throw new PipelineError(verdict.message, 400);
    // The photo goes to Claude for this one request. It is not written to disk or logged,
    // and fixture recording stores only the returned list.
    return runScan({ client, image, signal: req.signal });
  },
});
