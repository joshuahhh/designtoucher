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
