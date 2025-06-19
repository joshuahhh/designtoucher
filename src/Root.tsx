import { memo, useEffect, useRef } from "react";
import reglConstructor, { Texture2D, Texture2DOptions } from "regl";
import { onVideoFrame } from "./util.js";

/* ----------  Layout wrapper: full-viewport, black bg, centred ---------- */

export const Root = memo(() => (
  <div className="w-screen h-screen bg-black flex items-center justify-center">
    <Canvas />
  </div>
));

/* ----------  Canvas component with frame-difference shader ------------- */

type ReglProps = { videoTex: Texture2D; prevTex: Texture2D };

const Canvas = memo(() => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const regl = reglConstructor({ canvas });

    /* shader: |curr – prev| */
    const draw = regl({
      frag: `
        precision mediump float;
        uniform sampler2D videoTex, prevTex;
        varying vec2 uv;
        void main () {
          vec3 old = texture2D(prevTex, uv).rgb;
          vec3 new = texture2D(videoTex, uv).rgb;
          vec3 diff = abs(new - old);
          gl_FragColor = vec4(diff * 3.0, 1.0);
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
        videoTex: regl.prop<ReglProps, "videoTex">("videoTex"),
        prevTex: regl.prop<ReglProps, "prevTex">("prevTex"),
      },
    });

    /* --------  getUserMedia at viewport size  -------- */

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    videoRef.current = video;

    const constraints = {
      video: {
        width: { ideal: window.innerWidth, max: window.innerWidth },
        height: { ideal: window.innerHeight, max: window.innerHeight },
        facingMode: "user",
      },
    } as const;

    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      video.srcObject = stream;
      video.play();
    });

    /* --------  resize canvas to CSS px × DPR  -------- */

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      regl._gl.viewport(0, 0, canvas.width, canvas.height);
    };

    resize();
    window.addEventListener("resize", resize);

    /* --------  double-buffer textures & render loop  -------- */

    let texA: Texture2D | null = null; // current frame
    let texB: Texture2D | null = null; // previous frame

    const stop = onVideoFrame(video, () => {
      if (video.readyState >= 2) {
        const opts: Texture2DOptions = { data: video, flipY: true };
        if (!texA) {
          texA = regl.texture(opts);
          texB = regl.texture(opts); // init prev = curr
        } else {
          texA(opts); // update current
        }
        draw({ videoTex: texA!, prevTex: texB! });
        [texA, texB] = [texB!, texA!]; // swap
      }
    });

    /* --------  clean-up -------- */

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      regl.destroy();
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  return <canvas ref={canvasRef} className="block" />;
});
