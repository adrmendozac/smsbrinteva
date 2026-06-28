import { useEffect, useState } from "react";
import { Sun, Moon } from "@phosphor-icons/react";

type Mode = "light" | "dark";

function initialMode(): Mode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(initialMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
  }, [mode]);

  const next = mode === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      aria-label={`Switch to ${next} mode`}
      className="flex size-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
    >
      {mode === "dark" ? <Sun size={18} weight="fill" /> : <Moon size={18} weight="fill" />}
    </button>
  );
}
