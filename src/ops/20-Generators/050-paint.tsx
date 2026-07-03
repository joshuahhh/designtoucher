import { Inset, Popover } from "@radix-ui/themes";

import clsx from "clsx";
import { useCallback, useContext, useEffect, useRef } from "react";
import { ChromePicker } from "react-color";
import { FaTrash } from "react-icons/fa";
import { LuBrush, LuEraser } from "react-icons/lu";
import {
  destroyFbo,
  ensureFboSize,
  newFbo,
  newTex,
  ShaderProgram,
} from "../../mygl.js";
import {
  CHECKER_DARK,
  CHECKER_LIGHT,
  CHECKER_PIXELS,
  Monitor,
} from "../../OmniCanvas.js";
import {
  defineOp,
  MyPopoverContent,
  Sentence,
  SentenceParamNumber,
  TakeSnapshotContext,
} from "../../ops-core.js";

const W = 640;
const H = 360;

const CHECKER_TILE = Math.round((CHECKER_PIXELS / W) * 192) * 2;
const CHECKER_BG = `conic-gradient(hsl(0 0% ${CHECKER_LIGHT * 100}%) 90deg, hsl(0 0% ${CHECKER_DARK * 100}%) 90deg 180deg, hsl(0 0% ${CHECKER_LIGHT * 100}%) 180deg 270deg, hsl(0 0% ${CHECKER_DARK * 100}%) 270deg) 0 0 / ${CHECKER_TILE}px ${CHECKER_TILE}px`;

type PaintParams = {
  dataURL: string;
  color: string;
  brushSize: number;
  tool: "brush" | "eraser";
};

const BRUSH_VERT = `
  attribute vec2 position;
  varying vec2 uv;
  void main() {
    uv = 0.5 * (position + 1.0);
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const BRUSH_FRAG = `
  precision mediump float;
  varying vec2 uv;
  uniform sampler2D existing;
  uniform vec2 p1;
  uniform vec2 p2;
  uniform float radius;
  uniform vec3 brushColor;
  uniform vec2 resolution;
  uniform int tool;

  void main() {
    vec2 pos = vec2(uv.x, 1.0 - uv.y) * resolution;

    vec2 ab = p2 - p1;
    float abLen2 = dot(ab, ab);
    float t = abLen2 > 0.0 ? clamp(dot(pos - p1, ab) / abLen2, 0.0, 1.0) : 0.0;
    float d = length(pos - p1 - ab * t) - radius;

    float srcA = clamp(0.5 - d, 0.0, 1.0);

    vec4 dst = texture2D(existing, uv);

    if (tool == 0) {
      // Source-over compositing in straight alpha
      float dstA = dst.a;
      float outA = srcA + dstA * (1.0 - srcA);
      vec3 outRGB = outA > 0.001
        ? (brushColor * srcA + dst.rgb * dstA * (1.0 - srcA)) / outA
        : vec3(0.0);
      gl_FragColor = vec4(outRGB, outA);
    } else {
      // Destination-out (eraser)
      gl_FragColor = vec4(dst.rgb, dst.a * (1.0 - srcA));
    }
  }
`;

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function readFboToDataURL(gl: WebGL2RenderingContext, fb: WebGLFramebuffer) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const pixels = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const flipped = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W * 4;
    flipped.set(pixels.subarray(src, src + W * 4), y * W * 4);
  }
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  c.getContext("2d")!.putImageData(
    new ImageData(new Uint8ClampedArray(flipped.buffer), W, H),
    0,
    0,
  );
  return c.toDataURL();
}

export default defineOp({
  id: "paint",
  initParams: (): PaintParams => ({
    dataURL: "",
    color: "#ffffff",
    brushSize: 80,
    tool: "brush",
  }),
  initRuntime(ctx) {
    const { gl } = ctx;
    const outFbo = newFbo(gl);
    ensureFboSize(outFbo, W, H);
    const readTex = newTex(gl, W, H);

    gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return {
      gl,
      outFbo,
      readTex,
      brushProgram: new ShaderProgram(gl, BRUSH_VERT, BRUSH_FRAG),
      out: outFbo.tex,
      lastSyncedDataURL: "" as string,
    };
  },
  run({ runtime, params, ctx, notify }) {
    const { gl } = ctx;

    if (params.dataURL !== runtime.lastSyncedDataURL) {
      runtime.lastSyncedDataURL = params.dataURL;
      if (params.dataURL) {
        const img = new Image();
        img.onload = () => {
          gl.bindTexture(gl.TEXTURE_2D, runtime.outFbo.tex.texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            img,
          );
          notify();
        };
        img.src = params.dataURL;
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, runtime.outFbo.framebuffer);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }
  },
  destroy({ runtime }) {
    destroyFbo(runtime.outFbo);
    runtime.gl.deleteTexture(runtime.readTex.texture);
  },
  Render(props) {
    const { params, paramsUP, runtime } = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const takeSnapshot = useContext(TakeSnapshotContext);

    const colorRef = useRef(params.color);
    colorRef.current = params.color;
    const brushSizeRef = useRef(params.brushSize);
    brushSizeRef.current = params.brushSize;
    const toolRef = useRef(params.tool);
    toolRef.current = params.tool;
    const takeSnapshotRef = useRef(takeSnapshot);
    takeSnapshotRef.current = takeSnapshot;
    const paramsUPRef = useRef(paramsUP);
    paramsUPRef.current = paramsUP;

    useEffect(() => {
      if (!runtime) return;
      const container = containerRef.current;
      if (!container) return;

      const cursorDiv = document.createElement("div");
      cursorDiv.style.position = "absolute";
      cursorDiv.style.borderRadius = "50%";
      cursorDiv.style.border = "1.5px solid rgba(0,0,0,0.5)";
      cursorDiv.style.pointerEvents = "none";
      cursorDiv.style.display = "none";
      cursorDiv.style.zIndex = "10";
      container.appendChild(cursorDiv);

      const updateCursor = (e: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        const localScale = container.offsetWidth / W;
        const zoom =
          container.offsetWidth > 0 ? rect.width / container.offsetWidth : 1;
        const size = brushSizeRef.current * localScale;
        const x = (e.clientX - rect.left) / zoom;
        const y = (e.clientY - rect.top) / zoom;
        cursorDiv.style.width = `${size}px`;
        cursorDiv.style.height = `${size}px`;
        cursorDiv.style.left = `${x - size / 2}px`;
        cursorDiv.style.top = `${y - size / 2}px`;
        cursorDiv.style.display = "block";
      };

      let drawing = false;
      let lastX = 0;
      let lastY = 0;

      const getPos = (e: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        return {
          x: ((e.clientX - rect.left) / rect.width) * W,
          y: ((e.clientY - rect.top) / rect.height) * H,
        };
      };

      const drawBrushGL = (x1: number, y1: number, x2: number, y2: number) => {
        const gl = runtime.gl;

        // Snapshot current FBO into read texture
        gl.bindFramebuffer(gl.FRAMEBUFFER, runtime.outFbo.framebuffer);
        gl.bindTexture(gl.TEXTURE_2D, runtime.readTex.texture);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);

        const [r, g, b] = hexToRgb(colorRef.current);

        runtime.brushProgram.run({
          viewport: [0, 0, W, H],
          uniforms: {
            existing: ["sampler2D", runtime.readTex.texture],
            p1: ["2f", [x1, y1]],
            p2: ["2f", [x2, y2]],
            radius: ["1f", brushSizeRef.current / 2],
            brushColor: ["3f", [r / 255, g / 255, b / 255]],
            resolution: ["2f", [W, H]],
            tool: ["1i", toolRef.current === "eraser" ? 1 : 0],
          },
          fullscreen: true,
          targetFramebuffer: runtime.outFbo.framebuffer,
        });
      };

      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        console.log("paint pointerdown", {
          color: colorRef.current,
          brushSize: brushSizeRef.current,
        });
        takeSnapshotRef.current();
        drawing = true;
        container.setPointerCapture(e.pointerId);
        const pos = getPos(e);
        lastX = pos.x;
        lastY = pos.y;

        drawBrushGL(pos.x, pos.y, pos.x, pos.y);
      };

      const onPointerMove = (e: PointerEvent) => {
        updateCursor(e);
        if (!drawing) return;
        const pos = getPos(e);

        drawBrushGL(lastX, lastY, pos.x, pos.y);

        lastX = pos.x;
        lastY = pos.y;
      };

      const onPointerUp = () => {
        if (!drawing) return;
        drawing = false;
        const dataURL = readFboToDataURL(
          runtime.gl,
          runtime.outFbo.framebuffer,
        );
        runtime.lastSyncedDataURL = dataURL;
        paramsUPRef.current.dataURL.$set(dataURL);
      };

      const onPointerLeave = () => {
        if (!drawing) cursorDiv.style.display = "none";
      };

      console.log("paint effect setup");
      container.addEventListener("pointerdown", onPointerDown);
      container.addEventListener("pointermove", onPointerMove);
      container.addEventListener("pointerleave", onPointerLeave);
      container.addEventListener("pointerup", onPointerUp);

      return () => {
        console.log("paint effect cleanup");
        container.removeEventListener("pointerdown", onPointerDown);
        container.removeEventListener("pointermove", onPointerMove);
        container.removeEventListener("pointerleave", onPointerLeave);
        container.removeEventListener("pointerup", onPointerUp);
        cursorDiv.remove();
      };
    }, [runtime]);

    const handleClear = useCallback(() => {
      if (!runtime) return;
      takeSnapshot();

      const gl = runtime.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, runtime.outFbo.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      runtime.lastSyncedDataURL = "";
      paramsUP.dataURL.$set("");
    }, [runtime, paramsUP, takeSnapshot]);

    return (
      <>
        <Sentence>Paint</Sentence>
        <div className="flex w-full items-center gap-1 text-xs font-['Varela_Round']">
          <div className="flex overflow-hidden rounded border border-gray-300">
            <Popover.Root>
              <Popover.Trigger>
                <button
                  className={clsx(
                    "nodrag flex items-center gap-1 p-1 transition-colors",
                    params.tool === "brush"
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                  )}
                  onClick={() => paramsUP.tool.$set("brush")}
                  title="Brush"
                >
                  <LuBrush size={14} />
                  <div
                    className="h-3 w-3 rounded-sm border border-current"
                    style={{ backgroundColor: params.color }}
                  />
                </button>
              </Popover.Trigger>
              <MyPopoverContent>
                <Inset>
                  <ChromePicker
                    color={params.color}
                    onChange={({ hex }) => paramsUP.color.$set(hex)}
                  />
                </Inset>
              </MyPopoverContent>
            </Popover.Root>
            <button
              className={clsx(
                "nodrag border-l border-gray-300 p-1 transition-colors",
                params.tool === "eraser"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200",
              )}
              onClick={() => paramsUP.tool.$set("eraser")}
              title="Eraser"
            >
              <LuEraser size={14} />
            </button>
          </div>

          <div className="flex items-center gap-1 self-stretch rounded border border-gray-300 bg-gray-100 px-1">
            <span className="select-none text-[10px] text-gray-400">size</span>
            <SentenceParamNumber
              paramKey="brushSize"
              value={params.brushSize}
              valueUP={paramsUP.brushSize}
              min={1}
              max={100}
              step={1}
            />
          </div>

          <div className="flex-1" />
          <button
            className="nodrag rounded p-1 text-red-600 transition-colors hover:bg-red-50"
            onClick={handleClear}
            title="Clear"
          >
            <FaTrash size={12} />
          </button>
        </div>
        <div
          ref={containerRef}
          className="nodrag nopan overflow-hidden rounded-sm border border-gray-300"
          style={{
            position: "relative",
            width: 200,
            aspectRatio: `${W} / ${H}`,
            cursor: "crosshair",
            background: CHECKER_BG,
          }}
        >
          {runtime && (
            <Monitor tex={runtime.out} checkerboardPixels={CHECKER_PIXELS} />
          )}
        </div>
        <props.OutputHandle outputKey="out" showPreview={false} />
      </>
    );
  },
  searchHints: ["AKA: draw, sketch, freehand, doodle, canvas, brush."],
});
