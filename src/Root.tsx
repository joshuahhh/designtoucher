import { memo, useEffect, useRef, useState } from "react";
import { FpsView } from "react-fps";
import reglConstructor, { Texture2D, Texture2DOptions } from "regl";
import { onVideoFrame } from "./util.js";
import { useWebcam, WebcamSelect } from "./webcam.js";

type ReglProps = { texCurr: Texture2D; texPrev: Texture2D };

export const Root = memo(() => (
  <div className="w-screen h-screen bg-black flex flex-col items-center justify-center">
    <Canvas />
  </div>
));

const Canvas = memo(() => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [windowSize, setWindowSize] = useState<{
    width: number;
    height: number;
  }>({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const webcam = useWebcam({ width: 1280 });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const regl = reglConstructor({ canvas });

    const draw = regl({
      frag: `
        precision mediump float;
        uniform sampler2D texCurr, texPrev;
        varying vec2 uv;
        void main () {
          vec3 old = texture2D(texPrev, uv).rgb;
          vec3 new = texture2D(texCurr, uv).rgb;
          vec3 diff = abs(new - old);
          // float sum = diff.r + diff.g + diff.b;
          // gl_FragColor = vec4(new * (0.5 + 0.5 * sum), 1.0);
          gl_FragColor = vec4(diff * 9.0, 1.0);
          // gl_FragColor = vec4(new, 1.0);
        }`,
      vert: `
        precision mediump float;
        attribute vec2 position;
        varying vec2 uv;
        void main () {
          uv = 0.5 * (position + 1.0);
          gl_Position = vec4(position, 0.0, 1.0);
        }`,
      attributes: { position: [-1, -1, 1, -1, -1, 1, 1, 1] },
      elements: [
        [0, 1, 2],
        [2, 1, 3],
      ],
      uniforms: {
        texCurr: regl.prop<ReglProps, "texCurr">("texCurr"),
        texPrev: regl.prop<ReglProps, "texPrev">("texPrev"),
      },
    });

    let texCurr: Texture2D | null = null;
    let texPrev: Texture2D | null = null;

    const video = webcam.stream?.video;
    if (!video) return;

    const cancel = onVideoFrame(video, () => {
      if (video.readyState >= 2) {
        const opts: Texture2DOptions = { data: video, flipY: true };
        const beEconomical = true; // true to reuse textures, false to always create new ones
        if (beEconomical) {
          [texCurr, texPrev] = [texPrev, texCurr];
        } else {
          [texCurr, texPrev] = [null, texCurr];
        }
        if (!texCurr) {
          texCurr = regl.texture(opts);
        } else {
          texCurr(opts);
        }
        if (texPrev) {
          regl.poll();
          draw({ texCurr, texPrev });
        }
      }
    });

    return () => {
      cancel();
      regl.destroy();
    };
  }, [webcam]);

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!canvas) return;

    // scale canvas to window size, keeping aspect ratio of video
    if (!webcam.stream) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(
      windowSize.width / webcam.stream.width,
      windowSize.height / webcam.stream.height,
    );
    const w = webcam.stream.width * scale;
    const h = webcam.stream.height * scale;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    // regl._gl.viewport(0, 0, canvas.width, canvas.height);
  }, [webcam.stream, windowSize]);

  return (
    <>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
        <WebcamSelect webcam={webcam} className="mb-2 p-1 text-sm" />
      </div>
      <canvas ref={canvasRef} className="block" />
      <FpsView />
    </>
  );
});
