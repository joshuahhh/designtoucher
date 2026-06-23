import {
  Position,
  useConnection,
  useEdges,
  useNodeId,
  useReactFlow,
  useUpdateNodeInternals,
} from "@xyflow/react";
import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { UpdateProxy } from "update-proxy";
import {
  destroyFbo,
  ensureFboSize,
  Fbo,
  newFbo,
  ShaderProgram,
  Tex,
} from "../../mygl.js";
import { defineOp, makeInputHandleId, Sentence } from "../../ops-core.js";
import { tuple } from "../../util.js";

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
  uniform sampler2D texA;
  uniform sampler2D texB;
  uniform float opacity;
  uniform int blendMode;
  varying vec2 uv;
  void main() {
    vec4 A = texture2D(texA, uv);
    vec4 B = texture2D(texB, uv);
    B.a *= opacity;

    vec3 blended = B.rgb;
    if (blendMode == 1) {
      blended = A.rgb * B.rgb;
    } else if (blendMode == 2) {
      blended = A.rgb + B.rgb - A.rgb * B.rgb;
    } else if (blendMode == 3) {
      vec3 lo = 2.0 * A.rgb * B.rgb;
      vec3 hi = 1.0 - 2.0 * (1.0 - A.rgb) * (1.0 - B.rgb);
      blended = mix(lo, hi, step(0.5, A.rgb));
    } else if (blendMode == 4) {
      blended = A.rgb + B.rgb;
    } else if (blendMode == 5) {
      blended = min(A.rgb, B.rgb);
    } else if (blendMode == 6) {
      blended = max(A.rgb, B.rgb);
    } else if (blendMode == 7) {
      // mask: straight multiply of RGBA
      gl_FragColor = vec4(A.rgb * B.rgb, A.a * B.a) * opacity;
      return;
    }

    float outA = B.a + A.a * (1.0 - B.a);
    vec3 outRGB = (B.a * (1.0 - A.a) * B.rgb + B.a * A.a * blended + (1.0 - B.a) * A.a * A.rgb) / max(outA, 1e-6);
    gl_FragColor = vec4(outRGB, outA);
  }
`;

const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "add",
  "darken",
  "lighten",
  "mask",
] as const;
type BlendMode = (typeof BLEND_MODES)[number];

type LayerAttrs = {
  opacity: number;
  blendMode: BlendMode;
};

const defaultAttrs: LayerAttrs = { opacity: 1, blendMode: "normal" };

type LayersParams = {
  order: number[];
  nextId: number;
  attrs: Record<number, LayerAttrs>;
};

export default defineOp({
  id: "layers",
  inputKeys: [] as string[],
  outputKeys: ["out"],

  initParams(): LayersParams {
    return { order: [], nextId: 0, attrs: {} };
  },

  initRuntime(ctx) {
    const fboA = newFbo(ctx.gl);
    const fboB = newFbo(ctx.gl);
    const program = new ShaderProgram(ctx.gl, vertSrc, fragSrc);
    return { fboA, fboB, program, out: fboA.tex };
  },

  run({ runtime, inputs, params, ctx }) {
    const { order, attrs } = params as LayersParams;

    // Gather textures back-to-front (last in order = back, first = front)
    const layers: { tex: Tex; attrs: LayerAttrs }[] = [];
    for (let i = order.length - 1; i >= 0; i--) {
      const tex = (inputs as Record<string, Tex | null>)[`layer_${order[i]}`];
      if (tex) layers.push({ tex, attrs: attrs[order[i]] || defaultAttrs });
    }

    if (layers.length === 0) return;

    const fboA = runtime.fboA as Fbo;
    const fboB = runtime.fboB as Fbo;
    const program = runtime.program as ShaderProgram;
    const { width, height } = layers[0].tex;
    ensureFboSize(fboA, width, height);
    ensureFboSize(fboB, width, height);

    const { gl } = ctx;
    gl.disable(gl.BLEND);

    // Clear fboA to transparent, then composite all layers through the shader
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboA.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let read = fboA;
    let write = fboB;

    for (let i = 0; i < layers.length; i++) {
      const la = layers[i];
      program.run({
        targetFramebuffer: write.framebuffer,
        viewport: [0, 0, width, height],
        uniforms: {
          texA: tuple(["sampler2D", read.tex.texture] as const),
          texB: tuple(["sampler2D", la.tex.texture] as const),
          opacity: tuple(["1f", la.attrs.opacity] as const),
          blendMode: tuple([
            "1i",
            BLEND_MODES.indexOf(la.attrs.blendMode),
          ] as const),
        },
        fullscreen: true,
      });
      [read, write] = [write, read];
    }

    runtime.out = read.tex;
  },

  destroy({ runtime }) {
    destroyFbo(runtime.fboA as Fbo);
    destroyFbo(runtime.fboB as Fbo);
  },

  Render(props) {
    const nodeId = useNodeId()!;
    const edges = useEdges();
    const updateNodeInternals = useUpdateNodeInternals();
    const { deleteElements } = useReactFlow();

    const params = props.params as unknown as LayersParams;
    const paramsUP = props.paramsUP as unknown as UpdateProxy<LayersParams>;
    const isConnecting = useConnection((c) => c.inProgress);

    // Gap handles: one per insertion position
    // gap 0 = top "add" slot (always visible)
    // gaps 1..N = between/after rows (visible during connection drag)
    const gapCount = params.order.length + 1;
    const gapKey = (i: number) => `layer_${params.nextId + i}`;

    // Promote any gap handle that receives a connection
    useEffect(() => {
      for (let i = 0; i < gapCount; i++) {
        const key = `layer_${params.nextId + i}`;
        const handleId = makeInputHandleId(nodeId, key);
        if (edges.some((e) => e.targetHandle === handleId)) {
          const layerId = params.nextId + i;
          paramsUP.order.$((order: number[]) => {
            const next = [...order];
            next.splice(i, 0, layerId);
            return next;
          });
          paramsUP.attrs[layerId].$set({ ...defaultAttrs });
          paramsUP.nextId.$set(params.nextId + gapCount);
          break;
        }
      }
    }, [edges, params.nextId, gapCount, nodeId, paramsUP]);

    // Tell xyflow about handle changes
    useLayoutEffect(() => {
      updateNodeInternals(nodeId);
    }, [
      params.order.length,
      params.nextId,
      isConnecting,
      nodeId,
      updateNodeInternals,
    ]);

    // --- Drag-to-reorder ---
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const [dropTarget, setDropTarget_] = useState<number | null>(null);
    const dragIdxRef = useRef<number | null>(null);
    const dropTargetRef = useRef<number | null>(null);
    const setDropTarget = (v: number | null) => {
      dropTargetRef.current = v;
      setDropTarget_(v);
    };

    const handleDragStart = (idx: number) => (e: React.DragEvent) => {
      dragIdxRef.current = idx;
      setDragIdx(idx);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(idx));
      }
    };

    const rowsRef = useRef<HTMLDivElement>(null);

    const dropTargetFromY = (clientY: number): number => {
      const container = rowsRef.current;
      if (!container) return 0;
      const rows = container.querySelectorAll<HTMLElement>("[data-layer-row]");
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return i;
      }
      return rows.length;
    };

    const handleContainerDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(dropTargetFromY(e.clientY));
    };

    const handleContainerDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const fromIdx = dragIdxRef.current;
      const toIdx = dropTargetFromY(e.clientY);
      setDragIdx(null);
      setDropTarget(null);
      if (fromIdx === null || toIdx === fromIdx || toIdx === fromIdx + 1) {
        return;
      }
      paramsUP.order.$((order: number[]) => {
        const next = [...order];
        const [item] = next.splice(fromIdx, 1);
        const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
        next.splice(insertIdx, 0, item);
        return next;
      });
    };

    const handleDragEnd = () => {
      dragIdxRef.current = null;
      setDragIdx(null);
      setDropTarget(null);
    };

    const [selectedLayer, setSelectedLayer] = useState<number | null>(null);

    const handleRemove = (layerId: number) => {
      const handleId = makeInputHandleId(nodeId, `layer_${layerId}`);
      const edgesToRemove = edges.filter((e) => e.targetHandle === handleId);
      if (edgesToRemove.length > 0) {
        deleteElements({ edges: edgesToRemove });
      }
      paramsUP.order.$((order: number[]) =>
        order.filter((id) => id !== layerId),
      );
      const { [layerId]: _, ...rest } = params.attrs;
      paramsUP.attrs.$set(rest as any);
      if (selectedLayer === layerId) setSelectedLayer(null);
    };

    const gapHandle = (i: number) =>
      isConnecting && (
        <div
          key={`gap-${i}`}
          className="flex items-center gap-1 px-1 py-0.5 opacity-50"
        >
          <props.InputHandle
            inputKey={gapKey(i) as any}
            position={Position.Left}
          />
          <span className="text-[10px] text-blue-400 select-none">+</span>
        </div>
      );

    return (
      <>
        <Sentence>Layers</Sentence>
        <div
          className="flex items-stretch"
          onClick={() => setSelectedLayer(null)}
        >
          <div
            ref={rowsRef}
            className="flex flex-col w-[100px]"
            onDragOver={handleContainerDragOver}
            onDrop={handleContainerDrop}
          >
            {params.order.length === 0 && !isConnecting && (
              <span className="text-[10px] text-gray-400 select-none px-1 py-1 text-center">
                connect outputs here
              </span>
            )}
            {params.order.flatMap((layerId, idx) => {
              const la = params.attrs[layerId] || defaultAttrs;
              const isNonDefault =
                la.opacity !== 1 || la.blendMode !== "normal";
              return [
                gapHandle(idx),
                <div
                  key={`divider-${idx}`}
                  className={clsx(
                    "h-0.5 -my-0.5 relative z-10",
                    dropTarget === idx &&
                      dragIdx !== null &&
                      dragIdx !== idx &&
                      dragIdx !== idx - 1
                      ? "bg-blue-400"
                      : "bg-transparent",
                  )}
                />,
                <div
                  key={layerId}
                  data-layer-row
                  draggable
                  onDragStart={handleDragStart(idx)}
                  onDragEnd={handleDragEnd}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedLayer(
                      selectedLayer === layerId ? null : layerId,
                    );
                  }}
                  className={clsx(
                    "nodrag flex items-center gap-1 px-1 py-0.5 transition-colors cursor-pointer",
                    dragIdx === idx && "opacity-40",
                    selectedLayer === layerId && "bg-blue-500/20",
                  )}
                >
                  <props.InputHandle
                    inputKey={`layer_${layerId}` as any}
                    position={Position.Left}
                  />
                  {isNonDefault && (
                    <span className="text-[9px] text-gray-400 select-none ml-auto truncate">
                      {la.opacity !== 1 && `${Math.round(la.opacity * 100)}%`}
                      {la.opacity !== 1 && la.blendMode !== "normal" && " "}
                      {la.blendMode !== "normal" && la.blendMode}
                    </span>
                  )}
                  <span
                    className={clsx(
                      "text-gray-400 cursor-grab select-none text-[10px]",
                      !isNonDefault && "ml-auto",
                    )}
                  >
                    ⠿
                  </span>
                </div>,
              ];
            })}
            {gapHandle(params.order.length)}
            <div
              className={clsx(
                "h-0.5 -my-0.5 relative z-10",
                dropTarget === params.order.length &&
                  dragIdx !== null &&
                  dragIdx !== params.order.length - 1
                  ? "bg-blue-400"
                  : "bg-transparent",
              )}
            />
            {(() => {
              const sel =
                selectedLayer !== null && params.order.includes(selectedLayer)
                  ? selectedLayer
                  : null;
              const la =
                sel !== null ? params.attrs[sel] || defaultAttrs : defaultAttrs;
              return (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className={clsx(
                    "flex flex-col gap-px px-0.5 py-0.5 border-t border-gray-700 text-[9px] mt-auto",
                    sel === null && "opacity-30 pointer-events-none",
                  )}
                >
                  <div className="flex items-center gap-0.5 text-gray-400 select-none">
                    <span>opacity</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={la.opacity}
                      onChange={(e) =>
                        sel !== null &&
                        paramsUP.attrs[sel].opacity.$set(
                          parseFloat(e.target.value),
                        )
                      }
                      className="nodrag w-8 h-0.5 appearance-none bg-gray-300 rounded-full cursor-ew-resize [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-1.5 [&::-webkit-slider-thumb]:h-1.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-ew-resize"
                    />
                    <span>{Math.round(la.opacity * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <select
                      value={la.blendMode}
                      onChange={(e) =>
                        sel !== null &&
                        paramsUP.attrs[sel].blendMode.$set(
                          e.target.value as BlendMode,
                        )
                      }
                      className="nodrag h-4 bg-transparent text-gray-400 text-[9px] border border-gray-300 rounded px-0.5 outline-none cursor-pointer"
                    >
                      {BLEND_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => sel !== null && handleRemove(sel)}
                      className="nodrag h-4 text-gray-400 hover:text-red-400 text-[9px] border border-gray-300 hover:border-red-400/50 rounded px-0.5"
                    >
                      delete
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
          <props.OutputHandle outputKey="out" />
        </div>
      </>
    );
  },
});
