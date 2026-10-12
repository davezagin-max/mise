import planStore from "@/fixtures/plan.json";
import scanStore from "@/fixtures/scan.json";
import type { SampleFlags } from "@/components/app/FridgeStep";
import { MiseApp } from "@/components/app/MiseApp";
import { DemoBanner } from "@/components/kit/DemoBanner";
import { ThemeToggle } from "@/components/kit/ThemeToggle";
import { NUTRITION_META } from "@/lib/nutrition/foods";
import { SAMPLE_IDS } from "@/lib/samples";

/**
 * Whether each sample's demo data is a hand-written placeholder. Read from the
 * fixtures themselves, so the wording in the UI flips to "recorded" on its own
 * once `pnpm record` has replaced them with real runs.
 */
function sampleFlags(): SampleFlags {
  return Object.fromEntries(
    SAMPLE_IDS.map((id) => [
      id,
      { scan: scanStore[id].placeholder, plan: planStore[id].placeholder },
    ]),
  ) as SampleFlags;
}

export default function Home() {
  const flags = sampleFlags();
  const anyPlaceholder = Object.values(flags).some((flag) => flag.scan || flag.plan);

  return (
    <>
      <DemoBanner placeholder={anyPlaceholder} />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <p className="flex items-baseline gap-3">
          <span className="font-display text-2xl leading-none">Mise</span>
          <span className="hidden text-xs text-muted sm:inline">
            everything in its place, before you cook
          </span>
        </p>
        <ThemeToggle />
      </header>
      <MiseApp flags={flags} />
      <footer className="mt-8 border-t border-border px-4 py-5 text-xs text-muted">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
          <p>
            Nutrition figures are estimates from a bundled reference table (
            {NUTRITION_META.compiled}
            ), not dietary or medical advice. Shelf-life days are typical values for ordering, not a
            food-safety guarantee: check your food.
          </p>
          <p>Built with Claude Code and Claude Opus 5.5.</p>
        </div>
      </footer>
    </>
  );
}
