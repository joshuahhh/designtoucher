import { useEffect, useRef } from "react";
import {
  destroyFbo,
  ensureFboSize,
  newFbo,
  ShaderProgram,
} from "../../mygl.js";
import { defineOp, Sentence } from "../../ops-core.js";
import { tuple } from "../../util.js";

const HIST_W = 200;
const HIST_H = 40;
const HANDLE_H = 12;
const HIST_BINS = 256;
const SAMPLE_STRIDE = 4;

const vertSrc = `
  attribute vec2 position;
  varying vec2 uv;
  void main() {
    uv = 0.5 * (position + 1.0);
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragSrc = `
  precision mediump float;
  uniform sampler2D tex;
  uniform vec3 blackPoint;
  uniform vec3 whitePoint;
  uniform vec3 gamma;
  varying vec2 uv;
  void main() {
    vec4 color = texture2D(tex, uv);
    // Gamma first, then black/white remap
    vec3 curved = pow(clamp(color.rgb, 0.0, 1.0), 1.0 / gamma);
    vec3 range = max(whitePoint - blackPoint, vec3(1e-6));
    vec3 mapped = clamp((curved - blackPoint) / range, 0.0, 1.0);
    gl_FragColor = vec4(mapped, color.a);
  }
`;

type LevelsParams = {
  black: number;
  white: number;
  gamma: number;
};

export default defineOp({
  id: "levels",
  inputKeys: ["tex"],
  outputKeys: ["out"],

  initParams(): LevelsParams {
    return {
      black: 0,
      white: 1,
      gamma: 1,
    };
  },

  initRuntime(ctx) {
    const outFbo = newFbo(ctx.gl);
    return {
      program: new ShaderProgram(ctx.gl, vertSrc, fragSrc),
      outFbo,
      out: outFbo.tex,
      readFb: null as WebGLFramebuffer | null,
      histR: new Uint32Array(HIST_BINS),
      histG: new Uint32Array(HIST_BINS),
      histB: new Uint32Array(HIST_BINS),
      histFrame: 0,
    };
  },

  run({ runtime, inputs, params, ctx }) {
    const input = inputs.tex;
    if (!input) return;

    const { gl } = ctx;
    const { width, height } = input;

    // Read pixels for histogram
    if (!runtime.readFb) {
      runtime.readFb = gl.createFramebuffer()!;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, runtime.readFb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      input.texture,
      0,
    );
    const sampleW = Math.min(width, 320);
    const sampleH = Math.min(height, 240);
    const pixels = new Uint8Array(sampleW * sampleH * 4);
    gl.readPixels(0, 0, sampleW, sampleH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    runtime.histR.fill(0);
    runtime.histG.fill(0);
    runtime.histB.fill(0);
    for (let i = 0; i < pixels.length; i += 4 * SAMPLE_STRIDE) {
      runtime.histR[pixels[i]]++;
      runtime.histG[pixels[i + 1]]++;
      runtime.histB[pixels[i + 2]]++;
    }
    runtime.histFrame++;

    // Apply levels
    const p = params as LevelsParams;
    ensureFboSize(runtime.outFbo, width, height);

    runtime.program.run({
      viewport: [0, 0, width, height],
      uniforms: {
        tex: tuple(["sampler2D", input.texture] as const),
        blackPoint: tuple(["3f", [p.black, p.black, p.black]] as const),
        whitePoint: tuple(["3f", [p.white, p.white, p.white]] as const),
        gamma: tuple(["3f", [p.gamma, p.gamma, p.gamma]] as const),
      },
      fullscreen: true,
      targetFramebuffer: runtime.outFbo.framebuffer,
    });
  },

  destroy({ runtime }) {
    destroyFbo(runtime.outFbo);
    if (runtime.readFb) {
      runtime.outFbo.gl.deleteFramebuffer(runtime.readFb);
    }
  },

  Render(props) {
    const params = props.params as unknown as LevelsParams;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef<number>(0);
    const lastFrameRef = useRef<number>(-1);

    useEffect(() => {
      const draw = () => {
        animRef.current = requestAnimationFrame(draw);
        const runtime = props.runtime;
        const canvas = canvasRef.current;
        if (!runtime || !canvas) return;
        if (runtime.histFrame === lastFrameRef.current) return;
        lastFrameRef.current = runtime.histFrame;

        const ctx2d = canvas.getContext("2d")!;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = HIST_W * dpr;
        canvas.height = HIST_H * dpr;
        ctx2d.scale(dpr, dpr);
        ctx2d.clearRect(0, 0, HIST_W, HIST_H);

        const channels = [
          { hist: runtime.histR, color: "rgba(255,0,0,0.35)" },
          { hist: runtime.histG, color: "rgba(0,180,0,0.35)" },
          { hist: runtime.histB, color: "rgba(0,80,255,0.35)" },
        ];

        const invGamma = 1 / params.gamma;
        let totalSamples = 0;
        for (let i = 0; i < HIST_BINS; i++) totalSamples += runtime.histR[i];
        const fixedMax = (totalSamples / HIST_BINS) * 8;

        for (const { hist, color } of channels) {
          ctx2d.fillStyle = color;
          ctx2d.beginPath();
          ctx2d.moveTo(0, HIST_H);
          for (let i = 0; i < HIST_BINS; i++) {
            const t = i / (HIST_BINS - 1);
            const x = Math.pow(t, invGamma) * HIST_W;
            const jacobian =
              i === 0 ? params.gamma : params.gamma * Math.pow(t, 1 - invGamma);
            const h = Math.min(1, (hist[i] * jacobian) / fixedMax) * HIST_H;
            ctx2d.lineTo(x, HIST_H - h);
          }
          ctx2d.lineTo(HIST_W, HIST_H);
          ctx2d.closePath();
          ctx2d.fill();
        }

        // Shade crushed regions
        const bx = params.black * HIST_W;
        const wx = params.white * HIST_W;
        if (bx > 0) {
          ctx2d.fillStyle = "rgba(0,0,0,0.3)";
          ctx2d.fillRect(0, 0, bx, HIST_H);
        }
        if (wx < HIST_W) {
          ctx2d.fillStyle = "rgba(255,255,255,0.4)";
          ctx2d.fillRect(wx, 0, HIST_W - wx, HIST_H);
        }
      };
      animRef.current = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(animRef.current);
    }, [props.runtime, params]);

    const startDrag = (
      handle: "black" | "white" | "gamma",
      e: React.PointerEvent,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const container = canvasRef.current?.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      const onMove = (ev: PointerEvent) => {
        const x = Math.max(
          0,
          Math.min(1, (ev.clientX - rect.left) / rect.width),
        );
        if (handle === "black") {
          props.paramsUP.black.$set(Math.min(x, params.white - 0.01));
        } else if (handle === "white") {
          props.paramsUP.white.$set(Math.max(x, params.black + 0.01));
        } else {
          // Gamma handle position maps to gamma value
          // position 0.5 = gamma 1, left = brighter (gamma > 1), right = darker (gamma < 1)
          const clamped = Math.max(0.01, Math.min(0.99, x));
          props.paramsUP.gamma.$set(Math.log(0.5) / Math.log(clamped));
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      onMove(e.nativeEvent);
    };

    const bx = params.black * HIST_W;
    const wx = params.white * HIST_W;
    // Gamma handle: position where input maps to 0.5 output
    const gx = Math.pow(0.5, 1 / params.gamma) * HIST_W;

    return (
      <>
        <Sentence>
          Change lighting levels in <props.InputHandle inputKey="tex" />
        </Sentence>
        <div className="nodrag cursor-default" style={{ width: HIST_W }}>
          <div
            className="relative"
            style={{ width: HIST_W, height: HIST_H + HANDLE_H }}
          >
            <canvas
              ref={canvasRef}
              className="w-full bg-white rounded-sm"
              style={{ width: HIST_W, height: HIST_H }}
            />
            {/* Handle track */}
            <div
              className="relative"
              style={{ width: HIST_W, height: HANDLE_H }}
            >
              {/* Black handle */}
              <div
                className="absolute cursor-ew-resize"
                style={{
                  left: bx - 6,
                  top: 0,
                  width: 12,
                  height: HANDLE_H,
                }}
                onPointerDown={(e) => startDrag("black", e)}
                onDoubleClick={() => props.paramsUP.black.$set(0)}
              >
                <svg
                  width="12"
                  height={HANDLE_H}
                  viewBox="0 0 12 12"
                  className="overflow-visible"
                >
                  <path d="M6 0 L11 10 L1 10 Z" fill="black" />
                </svg>
              </div>
              {/* Gamma handle */}
              <div
                className="absolute cursor-ew-resize"
                style={{
                  left: gx - 6,
                  top: 0,
                  width: 12,
                  height: HANDLE_H,
                }}
                onPointerDown={(e) => startDrag("gamma", e)}
                onDoubleClick={() => props.paramsUP.gamma.$set(1)}
              >
                <svg
                  width="12"
                  height={HANDLE_H}
                  viewBox="0 0 12 12"
                  className="overflow-visible"
                >
                  <path d="M6 0 L11 10 L1 10 Z" fill="#888" />
                </svg>
              </div>
              {/* White handle */}
              <div
                className="absolute cursor-ew-resize"
                style={{
                  left: wx - 6,
                  top: 0,
                  width: 12,
                  height: HANDLE_H,
                }}
                onPointerDown={(e) => startDrag("white", e)}
                onDoubleClick={() => props.paramsUP.white.$set(1)}
              >
                <svg
                  width="12"
                  height={HANDLE_H}
                  viewBox="0 0 12 12"
                  className="overflow-visible"
                >
                  <path
                    d="M6 0 L11 10 L1 10 Z"
                    fill="white"
                    stroke="#666"
                    strokeWidth="1"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: [
    "levels",
    "histogram",
    "black point",
    "white point",
    "gamma",
    "curves",
    "exposure",
  ],
});
