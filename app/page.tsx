import { DemoBanner } from "@/components/kit/DemoBanner";

/** Placeholder while the UI is built; the routes and fixtures behind it are complete. */
export default function Home() {
  return (
    <>
      <DemoBanner placeholder />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <h1 className="text-xl font-semibold">Mise</h1>
      </main>
    </>
  );
}
