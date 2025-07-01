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

  let requestId: number;

  const loop = () => {
    callback();
    requestId = video.requestVideoFrameCallback(loop);
  };

  video.requestVideoFrameCallback(loop);

  return () => {
    console.warn("Cancelling video frame callback in onVideoFrame");
    video.cancelVideoFrameCallback(requestId);
  };
}
