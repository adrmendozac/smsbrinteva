import { ChatsCircle, Megaphone, Users, Gear } from "@phosphor-icons/react";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { icon: ChatsCircle, label: "Bandeja", active: true },
  { icon: Megaphone, label: "Campañas", active: false },
  { icon: Users, label: "Contactos", active: false },
  { icon: Gear, label: "Ajustes", active: false },
];

export function Sidebar() {
  return (
    <nav className="flex h-full w-16 flex-col items-center gap-2 bg-[var(--color-brand-navy)] py-4">
      {/* Brand mark: crimson B on navy */}
      <div
        className="flex size-10 items-center justify-center rounded-lg bg-[var(--color-brand-crimson)] text-lg font-extrabold text-white"
        title="Brinteva Worlds"
        aria-label="Brinteva Worlds"
      >
        B
      </div>
      <span className="sr-only">Brinteva</span>

      <div className="mt-4 flex flex-1 flex-col gap-1">
        {NAV.map(({ icon: Icon, label, active }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-current={active}
            className={[
              "flex size-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-[var(--focus)]",
              active ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            <Icon size={20} weight={active ? "fill" : "regular"} />
          </button>
        ))}
      </div>

      <ThemeToggle />
      <div
        className="mt-1 flex size-9 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-white"
        title="Agente conectado"
      >
        AM
      </div>
    </nav>
  );
}
