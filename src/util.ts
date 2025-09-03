import { useEffect, useMemo, useRef } from "react";
import stripIndent from "strip-indent";

export function useAnimationFrame(callback: () => void) {
  const requestRef = useRef<number>();

  useEffect(() => {
    const loop = () => {
      callback();
      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [callback]);
}

export function animate(callback: () => void) {
  let requestId: number;

  const loop = () => {
    callback();
    requestId = requestAnimationFrame(loop);
  };

  requestId = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(requestId);
  };
}

export function onVideoFrame(
  video: HTMLVideoElement | HTMLImageElement,
  callback: () => void,
) {
  if (video instanceof HTMLImageElement) {
    let intervalId = setInterval(callback, 33);

    return () => {
      clearInterval(intervalId);
    };
  }

  let cancelled = false;

  const loop = () => {
    if (cancelled) return;
    callback();
    video.requestVideoFrameCallback(loop);
  };

  video.requestVideoFrameCallback(loop);

  return () => {
    cancelled = true;
  };
}

export function pushBack<T>(arr: T[], item: T): void {
  arr.push(item);
}
export function popBack<T>(arr: T[]): T | undefined {
  return arr.pop();
}
export function pushFront<T>(arr: T[], item: T): void {
  arr.unshift(item);
}
export function popFront<T>(arr: T[]): T | undefined {
  return arr.shift();
}

export type Entries<T> = {
  [K in keyof T]: [K, T[K]];
}[keyof T][];

export function objectEntries<T extends object>(obj: T): Entries<T> {
  return Object.entries(obj) as Entries<T>;
}

export type FromEntries<T> =
  T extends ReadonlyArray<
    readonly [infer K extends string | number | symbol, infer _V]
  >
    ? { [key in K]: Extract<T[number], readonly [key, any]>[1] }
    : never;

export function objectFromEntries<
  T extends ReadonlyArray<readonly [PropertyKey, any]>,
>(entries: T): FromEntries<T> {
  return Object.fromEntries(entries) as FromEntries<T>;
}

export function objectKeys<T extends object>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[];
}

export const tuple = <T extends any[]>(xs: readonly [...T]): T => xs as T;

export function log<T>(obj: T, prefix: string = ""): T {
  console.log(prefix, obj);
  return obj;
}

export const instrument = (o: any) =>
  new Proxy(o, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      return typeof v === "function"
        ? function (...a: any[]) {
            console.log("🔍", String(p), ...a);
            return Reflect.apply(v, t, a);
          }
        : v;
    },
  });

const objectFingerprints = new WeakMap<object, number>();
let nextFingerprint = 0;
export function getFingerprint(obj: object): number {
  if (!objectFingerprints.has(obj)) {
    objectFingerprints.set(obj, nextFingerprint++);
  }
  return objectFingerprints.get(obj)!;
}

export function strip(strings: TemplateStringsArray, ...values: any[]): string {
  return stripIndent(
    strings.reduce((acc, str, i) => acc + str + (values[i] || ""), ""),
  ).trim();
}

export function tryOr<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function useDedupeObj<T extends object>(obj: T): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => obj, Object.values(obj));
}
