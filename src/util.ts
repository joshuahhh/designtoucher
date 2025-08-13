import { useEffect, useRef } from "react";

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

export const instrumentOld = (obj: any) =>
  new Proxy(obj, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      return typeof v !== "function"
        ? v
        : new Proxy(v, {
            apply(f, th, a) {
              console.log("🔍", String(p), ...a);
              return Reflect.apply(f, th, a);
            },
            construct(f, a, n) {
              console.log("🔍", String(p), ...a);
              return Reflect.construct(f, a, n);
            },
          });
    },
  });

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
