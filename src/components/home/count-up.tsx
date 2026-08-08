"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  to: number;
  suffix?: string;
  prefix?: string;
  duration?: number; // ms
  className?: string;
};

/** Counts up from 0 → `to` the first time it scrolls into view. */
export function CountUp({ to, suffix = "", prefix = "", duration = 1600, className }: Props) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(to);
      return;
    }

    // setInterval (not requestAnimationFrame) so the tween runs even when the
    // page isn't actively compositing frames.
    const animate = () => {
      if (started.current) return;
      started.current = true;
      cleanup();
      const start = Date.now();
      intervalRef.current = window.setInterval(() => {
        const p = Math.min(1, (Date.now() - start) / duration);
        // easeOutExpo for a snappy finish
        const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
        setValue(Math.round(to * eased));
        if (p >= 1 && intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }, 32);
    };

    // Start once the element is within (or above) the viewport. A plain
    // scroll-position check works reliably across every environment.
    const maybeStart = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.top < vh * 0.9 && r.bottom > 0) animate();
    };

    const cleanup = () => {
      window.removeEventListener("scroll", maybeStart);
      window.removeEventListener("resize", maybeStart);
    };

    window.addEventListener("scroll", maybeStart, { passive: true });
    window.addEventListener("resize", maybeStart);
    maybeStart(); // catch elements already in view on load

    return () => {
      cleanup();
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, [to, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}
