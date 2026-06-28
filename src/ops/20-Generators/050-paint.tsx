import { Inset, Popover } from "@radix-ui/themes";
import { Handle, Position, useNodeId } from "@xyflow/react";
import clsx from "clsx";
import { useCallback, useContext, useEffect, useRef } from "react";
import { ChromePicker } from "react-color";
import { FaTrash } from "react-icons/fa";
import { LuBrush, LuEraser } from "react-icons/lu";
import { newTex } from "../../mygl.js";
import {
  CHECKER_DARK,
  CHECKER_LIGHT,
  CHECKER_PIXELS,
} from "../../OmniCanvas.js";
import {
  defineOp,
  makeOutputHandleId,
  MyPopoverContent,
  Sentence,
  SentenceParamNumber,
  sharedHandleClasses,
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

export default defineOp({
  id: "paint",
  initParams: (): PaintParams => ({
    dataURL: "",
    color: "#ffffff",
    brushSize: 8,
    tool: "brush",
  }),
  initRuntime(ctx) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    return {
      out: newTex(ctx.gl, W, H),
      canvas,
      dirty: false,
      lastSyncedDataURL: "" as string,
    };
  },
  run({ runtime, params, ctx, notify }) {
    const { gl } = ctx;

    // Restore canvas from saved data (initial load or undo)
    if (params.dataURL !== runtime.lastSyncedDataURL) {
      runtime.lastSyncedDataURL = params.dataURL;
      if (params.dataURL) {
        const img = new Image();
        img.onload = () => {
          const c = runtime.canvas.getContext("2d")!;
          c.clearRect(0, 0, W, H);
          c.drawImage(img, 0, 0);
          gl.bindTexture(gl.TEXTURE_2D, runtime.out.texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            runtime.canvas,
          );
          notify();
        };
        img.src = params.dataURL;
      } else {
        runtime.canvas.getContext("2d")!.clearRect(0, 0, W, H);
        gl.bindTexture(gl.TEXTURE_2D, runtime.out.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          runtime.canvas,
        );
      }
      return;
    }

    if (runtime.dirty) {
      runtime.dirty = false;
      gl.bindTexture(gl.TEXTURE_2D, runtime.out.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        runtime.canvas,
      );
    }
  },
  destroy({ runtime, ctx }) {
    ctx.gl.deleteTexture(runtime.out.texture);
  },
  Render(props) {
    const { params, paramsUP, runtime } = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const takeSnapshot = useContext(TakeSnapshotContext);
    const nodeId = useNodeId();

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
      const canvas = runtime.canvas;
      const container = containerRef.current;
      if (!container) return;

      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      canvas.style.cursor = "crosshair";
      canvas.className = "nodrag nopan";
      container.appendChild(canvas);

      const cursorDiv = document.createElement("div");
      cursorDiv.style.position = "absolute";
      cursorDiv.style.borderRadius = "50%";
      cursorDiv.style.border = "1.5px solid rgba(0,0,0,0.5)";
      cursorDiv.style.pointerEvents = "none";
      cursorDiv.style.display = "none";
      container.appendChild(cursorDiv);

      const updateCursor = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        const zoom =
          canvas.offsetWidth > 0 ? rect.width / canvas.offsetWidth : 1;
        const localScale = canvas.offsetWidth / W;
        const size = brushSizeRef.current * localScale;
        const x = (e.clientX - rect.left) / zoom;
        const y = (e.clientY - rect.top) / zoom;
        cursorDiv.style.width = `${size}px`;
        cursorDiv.style.height = `${size}px`;
        cursorDiv.style.left = `${x - size / 2}px`;
        cursorDiv.style.top = `${y - size / 2}px`;
        cursorDiv.style.display = "block";
      };

      const ctx2d = canvas.getContext("2d")!;
      let drawing = false;
      let lastX = 0;
      let lastY = 0;

      const getPos = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: ((e.clientX - rect.left) / rect.width) * W,
          y: ((e.clientY - rect.top) / rect.height) * H,
        };
      };

      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const rect = canvas.getBoundingClientRect();
        console.log("paint pointerdown", {
          drawing,
          rectW: rect.width,
          rectH: rect.height,
          offsetW: canvas.offsetWidth,
          offsetH: canvas.offsetHeight,
          color: colorRef.current,
          brushSize: brushSizeRef.current,
          canvasParent: canvas.parentElement?.tagName,
        });
        takeSnapshotRef.current();
        drawing = true;
        canvas.setPointerCapture(e.pointerId);
        const pos = getPos(e);
        lastX = pos.x;
        lastY = pos.y;

        const size = brushSizeRef.current;
        ctx2d.globalCompositeOperation =
          toolRef.current === "eraser" ? "destination-out" : "source-over";
        ctx2d.fillStyle = colorRef.current;
        ctx2d.beginPath();
        ctx2d.arc(pos.x, pos.y, size / 2, 0, Math.PI * 2);
        ctx2d.fill();
        const pixel = ctx2d.getImageData(
          Math.round(pos.x),
          Math.round(pos.y),
          1,
          1,
        ).data;
        console.log(
          "paint after fill",
          "pos:",
          pos.x,
          pos.y,
          "pixel:",
          pixel[0],
          pixel[1],
          pixel[2],
          pixel[3],
        );
        runtime.dirty = true;
      };

      const onPointerMove = (e: PointerEvent) => {
        updateCursor(e);
        if (!drawing) return;
        const pos = getPos(e);
        const size = brushSizeRef.current;

        ctx2d.globalCompositeOperation =
          toolRef.current === "eraser" ? "destination-out" : "source-over";
        ctx2d.strokeStyle = colorRef.current;
        ctx2d.lineWidth = size;
        ctx2d.lineCap = "round";
        ctx2d.lineJoin = "round";
        ctx2d.beginPath();
        ctx2d.moveTo(lastX, lastY);
        ctx2d.lineTo(pos.x, pos.y);
        ctx2d.stroke();

        lastX = pos.x;
        lastY = pos.y;
        runtime.dirty = true;
      };

      const onPointerUp = () => {
        if (!drawing) return;
        drawing = false;
        ctx2d.globalCompositeOperation = "source-over";
        const dataURL = canvas.toDataURL();
        runtime.lastSyncedDataURL = dataURL;
        paramsUPRef.current.dataURL.$set(dataURL);
      };

      const onPointerLeave = () => {
        if (!drawing) cursorDiv.style.display = "none";
      };

      console.log("paint effect setup", {
        canvasInDOM: canvas.isConnected,
        containerChildren: container.childNodes.length,
      });
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);
      canvas.addEventListener("pointerup", onPointerUp);

      return () => {
        console.log("paint effect cleanup");
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerleave", onPointerLeave);
        canvas.removeEventListener("pointerup", onPointerUp);
        cursorDiv.remove();
        canvas.remove();
      };
    }, [runtime]);

    const handleClear = useCallback(() => {
      if (!runtime) return;
      takeSnapshot();
      runtime.canvas.getContext("2d")!.clearRect(0, 0, W, H);
      runtime.dirty = true;
      runtime.lastSyncedDataURL = "";
      paramsUP.dataURL.$set("");
    }, [runtime, paramsUP, takeSnapshot]);

    if (!nodeId) return null;

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
          className="nodrag nopan overflow-hidden rounded-sm border-4 border-black"
          style={{
            position: "relative",
            width: 200,
            aspectRatio: `${W} / ${H}`,
            cursor: "crosshair",
            background: CHECKER_BG,
          }}
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id={makeOutputHandleId(nodeId, "out")}
          className={clsx(
            sharedHandleClasses,
            "!relative !transform-none border-2 border-black hover:border-blue-300",
          )}
          style={{ width: 200, height: 8 }}
        />
      </>
    );
  },
  searchHints: ["AKA: draw, sketch, freehand, doodle, canvas, brush."],
});
