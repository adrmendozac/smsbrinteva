import { useRef, useState } from "react";
import {
  SignOut,
  PaperPlaneTilt,
  ClockCounterClockwise,
  AddressBook,
  ListMagnifyingGlass,
  List,
  X,
} from "@phosphor-icons/react";
import type { ComponentType, ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import logo from "../assets/brinteva-logo.png";
import { cn } from "../lib/cn";

export type Tab = "compose" | "history" | "contacts" | "logs";

type IconProps = { size?: number; weight?: "light" | "bold"; "aria-hidden"?: boolean };

const TABS: { key: Tab; label: string; icon: ComponentType<IconProps> }[] = [
  { key: "compose", label: "Nueva campaña", icon: PaperPlaneTilt },
  { key: "contacts", label: "Contactos", icon: AddressBook },
  { key: "history", label: "Historial", icon: ClockCounterClockwise },
  { key: "logs", label: "Registro", icon: ListMagnifyingGlass },
];

/**
 * Floating island rather than an edge-to-edge bar glued to the viewport: a
 * glass pill detached from the top, so the page reads as content on a surface
 * instead of content under a chrome strip. backdrop-blur is safe here because
 * the element is sticky, not part of the scrolling content.
 *
 * Below md the three tabs plus logout no longer fit the pill, so they collapse
 * behind a "Menu" button that drops a panel with the same controls stacked.
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
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // Reveal the mobile panel with a small stagger when it opens. It unmounts on
  // close, so this only ever animates the entrance; reduced-motion skips it.
  useGSAP(
    () => {
      if (!open || !panel.current) return;
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(panel.current, { autoAlpha: 0, y: -8, duration: 0.25, ease: "mass" });
        gsap.from(panel.current!.children, {
          autoAlpha: 0,
          y: -6,
          duration: 0.3,
          ease: "mass",
          stagger: 0.05,
        });
      });
    },
    { dependencies: [open] }
  );

  function pick(t: Tab) {
    onTab(t);
    setOpen(false);
  }

  return (
    <div className="sticky top-0 z-30 px-4 pt-6 pb-2">
      <div className="relative mx-auto w-max max-w-full">
      <header
        className="flex w-max max-w-full items-center gap-1 rounded-full bg-white/70 p-2 backdrop-blur-2xl sm:gap-2"
        style={{ boxShadow: `0 0 0 1px var(--hairline), var(--shadow-lifted)` }}
      >
        <div className="flex items-center gap-2 pl-2 pr-1">
          <img src={logo} alt="" width={28} height={28} className="size-7 shrink-0" />
          <span
            className="text-sm font-semibold tracking-tight"
            translate="no"
          >
            Brinteva <span className="text-[var(--brand)]">Worlds</span>
          </span>
        </div>

        {/* Full nav from md up. */}
        <nav className="hidden items-center gap-1 md:flex">
          {TABS.map(({ key, label, icon: Icon }) => (
            <TabButton key={key} active={tab === key} onClick={() => onTab(key)}>
              <Icon size={16} weight="light" aria-hidden={true} />
              {label}
            </TabButton>
          ))}
        </nav>

        <button
          onClick={onLogout}
          aria-label="Cerrar sesión"
          className="hidden size-9 touch-manipulation items-center justify-center rounded-full text-[var(--text-muted)] outline-none transition-[background-color,color,transform] duration-300 ease-[var(--ease-mass)] hover:bg-white hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] active:scale-95 md:inline-flex"
        >
          <SignOut size={16} weight="light" aria-hidden="true" />
        </button>

        {/* Below md: a single Menu toggle in place of the nav + logout. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="inline-flex touch-manipulation items-center gap-1.5 rounded-full px-3.5 py-2.5 text-[13px] font-medium text-[var(--text-muted)] outline-none transition-[background-color,color] duration-300 ease-[var(--ease-mass)] hover:bg-white/80 hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] active:scale-[0.98] md:hidden"
        >
          {open ? (
            <X size={16} weight="bold" aria-hidden="true" />
          ) : (
            <List size={16} weight="bold" aria-hidden="true" />
          )}
          Menu
        </button>
      </header>

      {/* Mobile dropdown: same controls, stacked. */}
      {open && (
        <div
          id="mobile-menu"
          ref={panel}
          className="absolute left-1/2 top-full z-10 mt-2 flex w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-1 rounded-3xl bg-white/80 p-2 backdrop-blur-2xl md:hidden"
          style={{ boxShadow: `0 0 0 1px var(--hairline), var(--shadow-lifted)` }}
        >
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => pick(key)}
              aria-current={tab === key ? "page" : undefined}
              className={cn(
                "inline-flex w-full touch-manipulation items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
                tab === key
                  ? "bg-[var(--primary)] text-[var(--primary-fg)] shadow-[var(--shadow-ambient)]"
                  : "text-[var(--text-muted)] hover:bg-white/80 hover:text-[var(--text-primary)]"
              )}
            >
              <Icon size={18} weight="light" aria-hidden={true} />
              {label}
            </button>
          ))}

          <div className="my-1 h-px bg-[var(--hairline)]" />

          <button
            onClick={onLogout}
            className="inline-flex w-full touch-manipulation items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium text-[var(--text-muted)] outline-none transition-colors hover:bg-white/80 hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <SignOut size={18} weight="light" aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
      )}
      </div>
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
