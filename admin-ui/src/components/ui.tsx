import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "brand";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[var(--primary)] text-[var(--primary-fg)] shadow-[var(--shadow-ambient)] hover:brightness-125 disabled:opacity-50",
  secondary:
    "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-[0_0_0_1px_var(--hairline),var(--shadow-ambient)] hover:bg-white disabled:opacity-50",
  ghost:
    "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/70 disabled:opacity-50",
  brand:
    "bg-[var(--brand)] text-white shadow-[var(--shadow-ambient)] hover:brightness-110 disabled:opacity-50",
};

// Weighted curve + a slight press scale so the control feels physical rather
// than toggling instantly. touch-manipulation kills the 300ms tap delay.
// Fully-rounded island with generous padding; press scale gives it mass.
const BASE =
  "group inline-flex touch-manipulation items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium outline-none transition-[opacity,background-color,transform,filter] duration-300 ease-[var(--ease-mass)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100";

// Shared so <Button> and <ButtonLink> cannot drift apart visually.
function buttonClass(variant: Variant, className?: string) {
  return cn(BASE, VARIANTS[variant], className);
}

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={buttonClass(variant, className)}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

// A link that reads as a button. Used for navigation out of the app, where an
// <a> is the correct element -- it opens in a new tab, offers the browser's own
// link affordances, and does not sit in the form's tab flow as a control.
export function ButtonLink({
  href,
  variant = "secondary",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClass(variant, className)}
    >
      {children}
    </a>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className
      )}
      aria-hidden
    />
  );
}

/**
 * Double-bezel enclosure: a tinted outer shell holding an inset white core, so
 * a card reads as a machined tray rather than a rectangle drawn on the page.
 * The core's radius is the shell's minus its padding, keeping the curves
 * concentric. `padded` off lets content run edge-to-edge inside the core.
 */
export function Card({
  children,
  className,
  ref,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  padded?: boolean;
}) {
  return (
    <div
      ref={ref}
      className={cn("p-1.5", className)}
      style={{
        borderRadius: "var(--r-shell)",
        background: "rgba(255,255,255,0.55)",
        boxShadow: `0 0 0 1px var(--hairline), var(--shadow-ambient)`,
      }}
    >
      <div
        className={cn("overflow-hidden bg-[var(--surface-elevated)]", padded && "p-5")}
        style={{
          borderRadius: "var(--r-core)",
          boxShadow: `0 0 0 1px var(--hairline), var(--inner-highlight)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "var(--status-completed)"
      : status === "sending"
      ? "var(--status-sending)"
      : status === "scheduled"
      ? "var(--status-scheduled)"
      : status === "failed"
      ? "var(--status-failed)"
      : "var(--status-draft)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label(status)}
    </span>
  );
}

function label(status: string): string {
  return (
    {
      draft: "Borrador",
      scheduled: "Programada",
      sending: "Enviando",
      completed: "Completada",
      failed: "Fallida",
    } as Record<string, string>
  )[status] ?? status;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </span>
        {hint && <span className="text-xs text-[var(--text-muted)]">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

/**
 * Trailing icon nested in its own circular well, flush with the button's inner
 * padding. On hover it drifts diagonally and scales, creating tension inside
 * the control instead of merely recolouring it.
 */
export function TrailingIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="-mr-3 ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15 transition-transform duration-300 ease-[var(--ease-mass)] group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105"
    >
      {children}
    </span>
  );
}

/** Microscopic pill that labels a section without competing with its heading. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)] shadow-[0_0_0_1px_var(--hairline)]">
      {children}
    </span>
  );
}

export const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus-visible:border-[var(--focus)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]/30";
