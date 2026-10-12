import type { ReactNode, SVGProps } from "react";

/** Class names for the three button weights used across the app. */
export const button = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium hover:border-fg/40 disabled:cursor-not-allowed disabled:opacity-50",
  quiet:
    "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-50",
};

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const CameraIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </Icon>
);
export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);
export const AlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </Icon>
);
export const ClockIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);
export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const MinusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h14" />
  </Icon>
);
export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const BackIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </Icon>
);
export const ArrowIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const LeafIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 19c0-8 5-13 14-14 0 9-5 14-14 14z" />
    <path d="M5 19l8-8" />
  </Icon>
);

/** A labelled minus / value / plus control for small whole numbers. */
export function Stepper({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  onChange,
  compact = false,
}: {
  label: string;
  value: number;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  const size = compact ? "size-9" : "size-11";
  const change = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => change(-step)}
        disabled={value <= min}
        aria-label={`Fewer: ${label}`}
        className={`${size} inline-flex items-center justify-center rounded-md border border-border bg-surface hover:border-fg/40 disabled:opacity-40`}
      >
        <MinusIcon />
      </button>
      <output
        aria-live="polite"
        className={`num text-center font-semibold ${compact ? "min-w-12 text-sm" : "min-w-16 text-base"}`}
      >
        {value}
        {unit ? <span className="ml-0.5 font-normal text-muted">{unit}</span> : null}
      </output>
      <button
        type="button"
        onClick={() => change(step)}
        disabled={value >= max}
        aria-label={`More: ${label}`}
        className={`${size} inline-flex items-center justify-center rounded-md border border-border bg-surface hover:border-fg/40 disabled:opacity-40`}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

/** A small rectangular tag. Meaning is always in the text, never the colour alone. */
export function Tag({
  tone = "plain",
  children,
  title,
}: {
  tone?: "plain" | "good" | "warn" | "bad" | "accent";
  children: ReactNode;
  title?: string;
}) {
  const tones = {
    plain: "border-border text-muted",
    good: "border-transparent bg-accent-soft text-accent",
    warn: "border-transparent bg-warn-soft text-warn",
    bad: "border-danger/40 text-danger",
    accent: "border-accent/40 text-accent",
  };
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase leading-4 tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** A message box for errors, refusals and demo misses. */
export function Notice({
  tone = "bad",
  title,
  children,
  actions,
}: {
  tone?: "bad" | "warn" | "info";
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const tones = {
    bad: "border-danger/50 bg-surface",
    warn: "border-warn/40 bg-warn-soft",
    info: "border-border bg-surface",
  };
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={`rise flex flex-col gap-2 rounded-lg border p-4 text-sm ${tones[tone]}`}
    >
      <p className={`font-semibold ${tone === "bad" ? "text-danger" : tone === "warn" ? "text-warn" : ""}`}>
        {title}
      </p>
      {children ? <div className="text-fg/90">{children}</div> : null}
      {actions ? <div className="mt-1 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** The small caps line that sits above a section title. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-muted">
      {children}
    </p>
  );
}
