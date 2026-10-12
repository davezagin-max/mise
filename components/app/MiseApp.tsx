"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useKey } from "@/components/kit/KeyProvider";
import type { ErrorKind } from "@/lib/api";
import { callApi } from "@/lib/client";
import { buildGroceryList } from "@/lib/grocery";
import { preparePhoto } from "@/lib/image-client";
import { NutritionResponse, extraStore } from "@/lib/nutrition/extra";
import { checkPlan } from "@/lib/plan/check";
import type { PlanData } from "@/lib/plan/schema";
import { summarizeChecks } from "@/lib/plan/summary";
import type { SampleId } from "@/lib/samples";
import { STEPS, canVisit, sessionStore, type Step } from "@/lib/session";
import type { ScanResult } from "@/lib/types";
import { ConfirmStep } from "./ConfirmStep";
import { FridgeStep, type SampleFlags } from "./FridgeStep";
import { GroceryStep } from "./GroceryStep";
import { Notice, button } from "./ui";
import { WeekStep } from "./WeekStep";

const STEP_TEXT: Record<Step, string> = {
  fridge: "Fridge",
  confirm: "Confirm",
  week: "Week",
  groceries: "Groceries",
};

interface Failure {
  during: "scan" | "plan";
  kind: ErrorKind;
  message: string;
}

const FAILURE_TITLE: Partial<Record<ErrorKind, string>> = {
  refusal: "Claude declined this request",
  demo_miss: "That needs a key",
  auth: "The key was not accepted",
  rate_limit: "Too many requests",
};

/** Errors, refusals and demo misses, each with the action that helps. */
function FailureNotice({
  failure,
  during,
  onRetry,
  onKey,
  onDismiss,
}: {
  failure: Failure | null;
  during: Failure["during"];
  onRetry?: () => void;
  onKey: () => void;
  onDismiss: () => void;
}) {
  if (!failure || failure.during !== during) return null;
  const fallback = during === "scan" ? "The scan did not work" : "The plan did not work";
  return (
    <Notice
      tone={failure.kind === "demo_miss" ? "info" : "bad"}
      title={FAILURE_TITLE[failure.kind] ?? fallback}
      actions={
        <>
          {(failure.kind === "demo_miss" || failure.kind === "auth") && (
            <button type="button" onClick={onKey} className={button.secondary}>
              {failure.kind === "auth" ? "Change key" : "Add key"}
            </button>
          )}
          {onRetry && failure.kind !== "demo_miss" && (
            <button type="button" onClick={onRetry} className={button.secondary}>
              Try again
            </button>
          )}
          <button type="button" onClick={onDismiss} className={button.quiet}>
            Dismiss
          </button>
        </>
      }
    >
      {failure.message}
    </Notice>
  );
}

/**
 * Asks the server to look up ingredients the bundled table does not have.
 * Optional by design: without a FoodData Central key on the server, or on any
 * failure, those ingredients simply stay marked "not in the nutrition data".
 */
async function lookUpMissing(names: string[]): Promise<void> {
  if (names.length === 0) return;
  try {
    const response = await fetch("/api/nutrition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ names: names.slice(0, 20) }),
    });
    if (!response.ok) return;
    const parsed = NutritionResponse.safeParse(await response.json());
    if (parsed.success && parsed.data.available) extraStore.add(parsed.data.foods);
  } catch {
    // Offline or blocked: nothing to add.
  }
}

/** Demo replies are instant; a short beat makes the change of screen readable. */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function MiseApp({ flags }: { flags: SampleFlags }) {
  const session = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getServerSnapshot,
  );
  // Changes when a FoodData Central lookup adds a food, so every figure is recomputed.
  const extras = useSyncExternalStore(
    extraStore.subscribe,
    extraStore.getSnapshot,
    extraStore.getServerSnapshot,
  );
  const { apiKey, isLive, openKeyModal } = useKey();
  const [loading, setLoading] = useState<SampleId | "photo" | "plan" | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const { step } = session;

  // Leaving the page abandons any request in flight, which stops the server's model calls.
  useEffect(() => () => request.current?.abort(), []);

  // The photo lives in memory for this tab only. Free it when it is replaced or the page goes.
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  // Each step is a new screen: start at its top and tell assistive tech where it is.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  const report = useMemo(() => {
    void extras;
    return session.plan ? checkPlan(session.plan.plan, session.prefs, session.items) : null;
  }, [session.plan, session.prefs, session.items, extras]);
  const checks = useMemo(
    () => (session.plan && report ? summarizeChecks(session.plan.plan, report, session.prefs) : []),
    [session.plan, report, session.prefs],
  );
  const groceries = useMemo(() => {
    void extras;
    return session.plan
      ? buildGroceryList(session.plan.plan, session.prefs, session.items, session.portions)
      : null;
  }, [session.plan, session.prefs, session.items, session.portions, extras]);

  function begin(what: SampleId | "photo" | "plan"): AbortController {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(what);
    setFailure(null);
    return controller;
  }

  function cancel() {
    request.current?.abort();
    request.current = null;
    setLoading(null);
  }

  async function scanSample(id: SampleId) {
    const controller = begin(id);
    const [response] = await Promise.all([
      callApi<ScanResult>("/api/scan", { demoId: id, sampleId: id }, apiKey, controller.signal),
      isLive ? null : pause(450),
    ]);
    if (controller.signal.aborted) return;
    setLoading(null);
    if (!response.ok) {
      setFailure({ during: "scan", kind: response.error.kind, message: response.error.message });
      return;
    }
    setPhotoUrl(null);
    sessionStore.dispatch({
      type: "scanned",
      sampleId: id,
      result: response.data,
      meta: response.meta,
    });
  }

  async function scanPhoto(file: File) {
    if (!isLive) {
      openKeyModal();
      return;
    }
    const controller = begin("photo");
    try {
      const photo = await preparePhoto(file);
      if (controller.signal.aborted) {
        URL.revokeObjectURL(photo.previewUrl);
        return;
      }
      const response = await callApi<ScanResult>(
        "/api/scan",
        { image: photo.image },
        apiKey,
        controller.signal,
      );
      if (controller.signal.aborted) {
        URL.revokeObjectURL(photo.previewUrl);
        return;
      }
      setLoading(null);
      if (!response.ok) {
        URL.revokeObjectURL(photo.previewUrl);
        setFailure({ during: "scan", kind: response.error.kind, message: response.error.message });
        return;
      }
      setPhotoUrl(photo.previewUrl);
      sessionStore.dispatch({
        type: "scanned",
        sampleId: null,
        result: response.data,
        meta: response.meta,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoading(null);
      setFailure({
        during: "scan",
        kind: "invalid",
        message: error instanceof Error ? error.message : "That photo could not be read.",
      });
    }
  }

  async function plan() {
    const controller = begin("plan");
    const body = {
      // A sample fridge's id is also the key its plan is recorded under.
      ...(session.sampleId ? { demoId: session.sampleId } : {}),
      ingredients: session.items.map(({ name, quantity, unit }) => ({ name, quantity, unit })),
      prefs: session.prefs,
    };
    const [response] = await Promise.all([
      callApi<PlanData>("/api/plan", body, apiKey, controller.signal),
      isLive ? null : pause(600),
    ]);
    if (controller.signal.aborted) return;
    setLoading(null);
    if (!response.ok) {
      setFailure({ during: "plan", kind: response.error.kind, message: response.error.message });
      return;
    }
    sessionStore.dispatch({ type: "planned", data: response.data, meta: response.meta });
    const { coverage } = checkPlan(response.data.plan, session.prefs, session.items);
    void lookUpMissing(coverage.missing);
  }

  const go = (next: Step) => {
    if (loading) cancel();
    setFailure(null);
    sessionStore.dispatch({ type: "stepSet", step: next });
  };
  const scanLoading = loading === "plan" ? null : loading;

  return (
    <>
      <nav aria-label="Steps" className="sticky top-0 z-30 border-b border-border bg-bg">
        <ol className="mx-auto grid w-full max-w-6xl grid-cols-4 px-2 sm:px-4">
          {STEPS.map((name) => {
            const current = name === step;
            const open = canVisit(session, name);
            return (
              <li key={name} className="min-w-0">
                <button
                  type="button"
                  onClick={() => go(name)}
                  disabled={!open}
                  aria-current={current ? "step" : undefined}
                  className={`flex min-h-11 w-full items-center justify-center border-b-[3px] px-1 text-sm font-medium disabled:cursor-not-allowed disabled:text-muted/60 ${
                    current
                      ? "border-accent text-fg"
                      : "border-transparent text-muted hover:text-fg"
                  }`}
                >
                  <span className="truncate">{STEP_TEXT[name]}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-10">
        {step === "fridge" && (
          <FridgeStep
            flags={flags}
            isLive={isLive}
            loading={scanLoading}
            headingRef={heading}
            onSample={scanSample}
            onPhoto={scanPhoto}
            onAddKey={openKeyModal}
            onCancel={cancel}
            notice={
              <FailureNotice
                failure={failure}
                during="scan"
                onKey={openKeyModal}
                onDismiss={() => setFailure(null)}
              />
            }
          />
        )}
        {step === "confirm" && (
          <ConfirmStep
            session={session}
            isLive={isLive}
            photoUrl={photoUrl}
            planning={loading === "plan"}
            planIsPlaceholder={session.sampleId ? flags[session.sampleId].plan : true}
            headingRef={heading}
            notice={
              <FailureNotice
                failure={failure}
                during="plan"
                onRetry={plan}
                onKey={openKeyModal}
                onDismiss={() => setFailure(null)}
              />
            }
            onSave={(id, item) => sessionStore.dispatch({ type: "itemSaved", id, item })}
            onAdd={(item) => sessionStore.dispatch({ type: "itemAdded", item })}
            onRemove={(id) => sessionStore.dispatch({ type: "itemRemoved", id })}
            onPrefs={(prefs) => sessionStore.dispatch({ type: "prefsChanged", prefs })}
            onPlan={plan}
            onCancel={cancel}
          />
        )}
        {step === "week" && report && (
          <WeekStep
            session={session}
            report={report}
            checks={checks}
            isLive={isLive}
            headingRef={heading}
            notice={
              <FailureNotice
                failure={failure}
                during="plan"
                onRetry={plan}
                onKey={openKeyModal}
                onDismiss={() => setFailure(null)}
              />
            }
            onPrefs={(prefs) => sessionStore.dispatch({ type: "prefsChanged", prefs })}
            onPortions={(recipeId, portions) =>
              sessionStore.dispatch({ type: "portionsSet", recipeId, portions })
            }
            onGroceries={() => go("groceries")}
            onReplan={() => {
              go("confirm");
              void plan();
            }}
          />
        )}
        {step === "groceries" && report && groceries && (
          <GroceryStep
            list={groceries}
            report={report}
            checked={session.checked}
            people={session.prefs.servings}
            headingRef={heading}
            onToggle={(key, checked) => sessionStore.dispatch({ type: "checkedSet", key, checked })}
            onClear={() => sessionStore.dispatch({ type: "checkedCleared" })}
            onWeek={() => go("week")}
          />
        )}
      </main>
    </>
  );
}
