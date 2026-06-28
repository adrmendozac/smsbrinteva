import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "brand";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[var(--primary)] text-[var(--primary-fg)] hover:opacity-90 disabled:opacity-50",
  secondary:
    "bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] hover:bg-[var(--surface-sunken)] disabled:opacity-50",
  ghost:
    "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] disabled:opacity-50",
  brand:
    "bg-[var(--brand)] text-white hover:opacity-90 disabled:opacity-50",
};

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
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-[opacity,background-color] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed",
        VARIANTS[variant],
        className
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
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

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5",
        className
      )}
    >
      {children}
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

export const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus-visible:border-[var(--focus)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]/30";
