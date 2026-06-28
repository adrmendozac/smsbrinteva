import { SignOut, PaperPlaneTilt, ClockCounterClockwise } from "@phosphor-icons/react";
import { cn } from "../lib/cn";

export type Tab = "compose" | "history";

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
    <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface-elevated)]/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
        <div className="font-semibold tracking-tight">
          Brinteva <span className="text-[var(--brand)]">Worlds</span>
        </div>

        <nav className="ml-2 flex items-center gap-1">
          <TabButton active={tab === "compose"} onClick={() => onTab("compose")}>
            <PaperPlaneTilt size={16} weight="bold" /> Nueva campaña
          </TabButton>
          <TabButton active={tab === "history"} onClick={() => onTab("history")}>
            <ClockCounterClockwise size={16} weight="bold" /> Historial
          </TabButton>
        </nav>

        <button
          onClick={onLogout}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
        >
          <SignOut size={16} /> Salir
        </button>
      </div>
    </header>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-[var(--surface-sunken)] text-[var(--text-primary)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      )}
    >
      {children}
    </button>
  );
}
