"use client";

import { useKey } from "./KeyProvider";

interface DemoBannerProps {
  /**
   * True while the fixtures are hand-written samples rather than recorded
   * model runs. The banner says so plainly instead of implying a real run.
   */
  placeholder?: boolean;
  /** Set to false for projects whose core features need no key at all. */
  aiRequired?: boolean;
}

/** A single calm line: what the visitor is seeing and how to run it for real. */
export function DemoBanner({ placeholder = false, aiRequired = true }: DemoBannerProps) {
  const { isLive, openKeyModal } = useKey();
  const shell =
    "border-b border-border bg-surface px-4 py-1.5 text-center text-xs leading-5 text-muted sm:text-[0.8125rem]";
  const link =
    "font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent";

  if (isLive) {
    return (
      <div className={shell}>
        <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-success" />
        Live: Claude Opus 5.5 is answering with your key.{" "}
        <button type="button" onClick={openKeyModal} className={link}>
          Change key
        </button>
      </div>
    );
  }

  const lead = !aiRequired
    ? "Everything here works without a key."
    : placeholder
      ? "Demo: the AI responses here are pre-written examples."
      : "Demo: the AI responses here are recorded Claude Opus 5.5 runs, replayed.";

  return (
    <div role="status" className={shell}>
      {lead}{" "}
      <button type="button" onClick={openKeyModal} className={link}>
        Add your Anthropic API key
      </button>{" "}
      {aiRequired ? "to run it live." : "to turn on the Claude Opus 5.5 features."}
    </div>
  );
}
