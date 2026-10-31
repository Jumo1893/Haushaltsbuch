import { useLayoutEffect, useRef, useState } from "react";

/** Runde Werte für eine Achse (Vielfache von 1, 2, 2,5 oder 5 · 10ⁿ), die min, max und 0 einschließen */
export function niceTicks(min: number, max: number, count = 4) {
  const lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (hi - lo < 100) hi = lo + 100; // fast nur Nullen
  const raw = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((s) => s >= raw) ?? 10 * power;
  const first = Math.floor(lo / step);
  const last = Math.ceil(hi / step);
  return Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step);
}

/** Platz links für die Beschriftung der y-Achse, geschätzt aus der Zeichenzahl */
export const axisWidth = (labels: string[]) => Math.max(...labels.map((l) => l.length)) * 7 + 10;

const LABEL_STEPS = [1, 2, 3, 6, 12];

/** Jeder wievielte Monat beschriftet wird (am Kalender ausgerichtet), damit nichts überlappt */
export function monthLabelStep(count: number, width: number) {
  const fit = Math.max(1, Math.floor(width / 52));
  return LABEL_STEPS.find((step) => Math.ceil(count / step) <= fit) ?? 12;
}

/** Jeder wievielte Tag beschriftet wird, damit nichts überlappt */
export const dayLabelStep = (count: number, width: number) => Math.ceil(count / Math.max(1, Math.floor(width / 52)));

/** true, wenn der Monat (YYYY-MM) bei diesem Abstand beschriftet wird; der Januar ist immer dabei */
export const isLabeled = (month: string, step: number) => (Number(month.slice(5, 7)) - 1) % step === 0;

/** Breite eines Elements in Pixeln, aktuell bei jeder Größenänderung */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Position des Tooltips neben dem Fadenkreuz bei x; in der rechten Hälfte links davon */
export const tipPosition = (x: number, width: number) => (x > width / 2 ? { right: width - x + 12 } : { left: x + 12 });

/** Index des letzten Werts, der nicht null ist, sonst −1 */
export function lastIndex(values: (number | null)[]) {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i;
  return -1;
}
