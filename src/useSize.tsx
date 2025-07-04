import { useLayoutEffect, useState } from "react";

function useSizeWithElem(
  elem: HTMLElement | null,
): DOMRectReadOnly | undefined {
  const [domRect, setDomRect] = useState<DOMRectReadOnly | undefined>(
    undefined,
  );

  useLayoutEffect(() => {
    if (elem) {
      const observer = new ResizeObserver((entries) =>
        setDomRect(entries[0].contentRect),
      );
      observer.observe(elem);
      return () => {
        observer.disconnect();
        setDomRect(undefined);
      };
    }
  }, [elem]);

  return domRect;
}

function useSizeWithoutElem(): [
  (elem: HTMLElement | null) => void,
  DOMRectReadOnly | undefined,
] {
  const [elem, setElem] = useState<HTMLElement | null>(null);
  const domRect = useSizeWithElem(elem);
  return [setElem, domRect];
}

export function useSize(elem: HTMLElement | null): DOMRectReadOnly | undefined;
export function useSize(): [
  (elem: HTMLElement | null) => void,
  DOMRectReadOnly | undefined,
];
export function useSize(
  maybeElem?: HTMLElement | null,
):
  | DOMRectReadOnly
  | undefined
  | [(elem: HTMLElement | null) => void, DOMRectReadOnly | undefined] {
  if (maybeElem !== undefined) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useSizeWithElem(maybeElem);
  } else {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useSizeWithoutElem();
  }
}
