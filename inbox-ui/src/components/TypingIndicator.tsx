import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { useReducedMotion } from "../hooks/useReducedMotion";

export function TypingIndicator({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!active || reduced || !ref.current) return;
    const ctx = gsap.context(() => {
      gsap.to(".typing-dot", {
        y: -3,
        autoAlpha: 1,
        duration: 0.45,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        stagger: 0.15,
      });
    }, ref);
    return () => ctx.revert();
  }, [active, reduced]);

  if (!active) return null;

  return (
    <div
      ref={ref}
      role="status"
      className="flex items-center gap-1.5 px-5 pb-2"
      aria-label="El contacto está escribiendo"
    >
      <span className="sr-only">El contacto está escribiendo</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="typing-dot size-1.5 rounded-full bg-[var(--text-muted)]"
          aria-hidden
        />
      ))}
    </div>
  );
}
