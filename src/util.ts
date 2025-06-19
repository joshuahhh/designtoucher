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

export function onVideoFrame(video: HTMLVideoElement, callback: () => void) {
  let requestId: number;

  const loop = () => {
    callback();
    requestId = video.requestVideoFrameCallback(loop);
  };

  video.requestVideoFrameCallback(loop);

  return () => {
    video.cancelVideoFrameCallback(requestId);
  };
}
