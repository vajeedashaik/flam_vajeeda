import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from its previous value to `target` over `ms`.
 * Respects prefers-reduced-motion (jumps straight to the target).
 * Presentation only — never used in a value that logic depends on.
 */
export function useCountUp(target: number, ms = 480): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const from = fromRef.current;
    const to = target;
    if (reduce || from === to) {
      setValue(to);
      fromRef.current = to;
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, ms]);

  return value;
}
