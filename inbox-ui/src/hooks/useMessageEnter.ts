import { useEffect, useRef, type RefObject } from "react";
import { gsap } from "gsap";
import { useReducedMotion } from "./useReducedMotion";

/**
 * Animates the most recently added message bubble into view.
 * Transform + opacity only (compositor-friendly); no-op under reduced motion.
 */
export function useMessageEnter(ref: RefObject<HTMLElement | null>, count: number) {
  const reduced = useReducedMotion();
  const prev = useRef(count);

  useEffect(() => {
    const added = count > prev.current;
    prev.current = count;
    if (reduced || !added || !ref.current) return;

    const last = ref.current.lastElementChild as HTMLElement | null;
    if (!last) return;

    const ctx = gsap.context(() => {
      gsap.from(last, { y: 12, autoAlpha: 0, duration: 0.4, ease: "power2.out" });
    }, ref);
    return () => ctx.revert();
  }, [count, reduced, ref]);
}
