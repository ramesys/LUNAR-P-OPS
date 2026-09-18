import { useEffect, useState, type RefObject } from "react";

/** Content width of an element in CSS pixels, kept up to date on resize. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState<number>(fallback);

  useEffect((): (() => void) | undefined => {
    const element: HTMLElement | null = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer: ResizeObserver = new ResizeObserver((entries: ResizeObserverEntry[]): void => {
      const measured: number | undefined = entries[0]?.contentRect.width;
      if (measured !== undefined && measured > 0) {
        setWidth(Math.round(measured));
      }
    });
    observer.observe(element);
    return (): void => {
      observer.disconnect();
    };
  }, [ref]);

  return width;
}
