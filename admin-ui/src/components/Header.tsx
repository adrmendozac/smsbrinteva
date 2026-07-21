import { SignOut, PaperPlaneTilt, ClockCounterClockwise } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import logo from "../assets/brinteva-logo.png";
import { cn } from "../lib/cn";

export type Tab = "compose" | "history";

/**
 * Floating island rather than an edge-to-edge bar glued to the viewport: a
 * glass pill detached from the top, so the page reads as content on a surface
 * instead of content under a chrome strip. backdrop-blur is safe here because
 * the element is sticky, not part of the scrolling content.
 */
export function Header({
  tab,
  onTab,
  onLogout,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  onLogout: () => void;
}) {
  return (
    <div className="sticky top-0 z-30 px-4 pt-6 pb-2">
      <header
        className="mx-auto flex w-max max-w-full items-center gap-1 rounded-full bg-white/70 p-2 backdrop-blur-2xl sm:gap-2"
        style={{ boxShadow: `0 0 0 1px var(--hairline), var(--shadow-lifted)` }}
      >
        {/* The wordmark yields on small screens so the tab labels can stay --
            knowing which tab you are on matters more than repeating the brand. */}
        <div className="flex items-center gap-2 pl-2 pr-1">
          <img
            src={logo}
            alt=""
            width={28}
            height={28}
            className="size-7 shrink-0"
          />
          <span
            className="hidden text-sm font-semibold tracking-tight md:inline"
            translate="no"
          >
            Brinteva <span className="text-[var(--brand)]">Worlds</span>
          </span>
        </div>

        <nav className="flex items-center gap-1">
          <TabButton active={tab === "compose"} onClick={() => onTab("compose")}>
            <PaperPlaneTilt size={16} weight="light" aria-hidden="true" />
            Nueva campaña
          </TabButton>
          <TabButton active={tab === "history"} onClick={() => onTab("history")}>
            <ClockCounterClockwise size={16} weight="light" aria-hidden="true" />
            Historial
          </TabButton>
        </nav>

        <button
          onClick={onLogout}
          aria-label="Cerrar sesión"
          className="inline-flex size-9 touch-manipulation items-center justify-center rounded-full text-[var(--text-muted)] outline-none transition-[background-color,color,transform] duration-300 ease-[var(--ease-mass)] hover:bg-white hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] active:scale-95"
        >
          <SignOut size={16} weight="light" aria-hidden="true" />
        </button>
      </header>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex touch-manipulation items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2.5 text-[13px] font-medium outline-none transition-[background-color,color,box-shadow,transform] duration-300 ease-[var(--ease-mass)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] active:scale-[0.98] sm:px-4 sm:text-sm",
        active
          ? "bg-[var(--primary)] text-[var(--primary-fg)] shadow-[var(--shadow-ambient)]"
          : "text-[var(--text-muted)] hover:bg-white/80 hover:text-[var(--text-primary)]"
      )}
    >
      {children}
    </button>
  );
}
