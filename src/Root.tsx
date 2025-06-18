import { memo, useEffect, useRef } from "react";
import reglConstructor, { Texture2D, Texture2DOptions } from "regl";
import { animate } from "./util.js";

export const Root = memo(() => {
  return (
    <div className="prose p-6">
      <h1>my-vite</h1>
      <p>hi</p>
      <Canvas />
    </div>
  );
});

type ReglProps = {
  videoTex: Texture2D;
  prevTex: Texture2D;
};

export const Canvas = memo(() => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    videoRef.current = video;
    navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: 9999, max: 9999 },
          height: { ideal: 9999, max: 9999 },
          facingMode: "user",
        },
      })
      .then((stream) => {
        video.srcObject = stream;
        video.play();

        video.onloadedmetadata = () => {
          const width = video.videoWidth;
          const height = video.videoHeight;
          console.log(width, height);

          canvas.style.width = width + "px";
          canvas.style.height = height + "px";
          const dpr = window.devicePixelRatio || 1;
          canvas.width = width * dpr;
          canvas.height = height * dpr;
        };
      });

    const regl = reglConstructor({ canvas });
    const draw = regl({
      frag: `
        precision mediump float;
        uniform sampler2D videoTex;
        uniform sampler2D prevTex;
        varying vec2 uv;
        void main() {
          vec3 curr = texture2D(videoTex, uv).rgb;
          vec3 prev = texture2D(prevTex, uv).rgb;
          vec3 diff = abs(curr - prev);
          gl_FragColor = vec4(diff, 1.0);
        }
      `,
      vert: `
        precision mediump float;
        attribute vec2 position;
        varying vec2 uv;
        void main() {
          uv = 0.5 * (position + 1.0);
          gl_Position = vec4(position, 0, 1);
        }
      `,
      attributes: {
        position: [-1, -1, 1, -1, -1, 1, 1, 1],
      },
      elements: [
        [0, 1, 2],
        [2, 1, 3],
      ],
      uniforms: {
        videoTex: regl.prop<ReglProps, "videoTex">("videoTex"),
        prevTex: regl.prop<ReglProps, "prevTex">("prevTex"),
      },
    });

    let texA: Texture2D | null = null;
    let texB: Texture2D | null = null;

    const cancelAnimation = animate(() => {
      if (video.readyState >= 2) {
        const texOpts: Texture2DOptions = { data: video, flipY: true };

        if (!texA) {
          texA = regl.texture(texOpts);
          texB = regl.texture(texOpts); // initialize to same
        } else {
          texA(texOpts); // update current frame
        }

        draw({ videoTex: texA!, prevTex: texB! });

        // Swap A and B for next frame
        [texA, texB] = [texB, texA];
      }
    });

    return () => {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
      regl.destroy();
      cancelAnimation();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 1280, height: 720, display: "block" }}
    />
  );
});
