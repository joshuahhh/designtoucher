import {
  Position,
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
  varying vec2 uv;
  void main() {
    vec4 A = texture2D(texA, uv);
    vec4 B = texture2D(texB, uv);
    float outA = B.a + A.a * (1.0 - B.a);
    vec3 outRGB = (B.rgb * B.a + A.rgb * A.a * (1.0 - B.a)) / max(outA, 1e-6);
    gl_FragColor = vec4(outRGB, outA);
  }
`;

type LayersParams = {
  order: number[];
  nextId: number;
};

export default defineOp({
  id: "layers",
  inputKeys: [] as string[],
  outputKeys: ["out"],

  initParams(): LayersParams {
    return { order: [], nextId: 0 };
  },

  initRuntime(ctx) {
    const fboA = newFbo(ctx.gl);
    const fboB = newFbo(ctx.gl);
    const program = new ShaderProgram(ctx.gl, vertSrc, fragSrc);
    return { fboA, fboB, program, out: fboA.tex };
  },

  run({ runtime, inputs, params, ctx }) {
    const { order } = params as LayersParams;

    // Gather textures back-to-front (last in order = back, first = front)
    const layers: Tex[] = [];
    for (let i = order.length - 1; i >= 0; i--) {
      const tex = (inputs as Record<string, Tex | null>)[`layer_${order[i]}`];
      if (tex) layers.push(tex);
    }

    if (layers.length === 0) return;

    const fboA = runtime.fboA as Fbo;
    const fboB = runtime.fboB as Fbo;
    const program = runtime.program as ShaderProgram;
    const { width, height } = layers[0];
    ensureFboSize(fboA, width, height);
    ensureFboSize(fboB, width, height);

    const { gl } = ctx;
    gl.disable(gl.BLEND);

    if (layers.length === 1) {
      ctx.draw({
        tex: layers[0],
        targetFramebuffer: fboA.framebuffer,
        viewport: [0, 0, width, height],
      });
      runtime.out = fboA.tex;
      return;
    }

    // Copy bottom layer to fboA
    ctx.draw({
      tex: layers[0],
      targetFramebuffer: fboA.framebuffer,
      viewport: [0, 0, width, height],
    });

    let read = fboA;
    let write = fboB;

    for (let i = 1; i < layers.length; i++) {
      program.run({
        targetFramebuffer: write.framebuffer,
        viewport: [0, 0, width, height],
        uniforms: {
          texA: tuple(["sampler2D", read.tex.texture] as const),
          texB: tuple(["sampler2D", layers[i].texture] as const),
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

    // The "add" slot is always layer_{nextId}
    const addKey = `layer_${params.nextId}`;
    const addHandleId = makeInputHandleId(nodeId, addKey);
    const hasAddConnection = edges.some((e) => e.targetHandle === addHandleId);

    // When someone connects to the add slot, promote it to a real layer
    useEffect(() => {
      if (hasAddConnection) {
        paramsUP.order.$((order: number[]) => [params.nextId, ...order]);
        paramsUP.nextId.$set(params.nextId + 1);
      }
    }, [hasAddConnection, params.nextId, paramsUP]);

    // Tell xyflow about handle changes
    useLayoutEffect(() => {
      updateNodeInternals(nodeId);
    }, [params.order.length, params.nextId, nodeId, updateNodeInternals]);

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

    const handleRemove = (idx: number) => () => {
      const layerId = params.order[idx];
      const handleId = makeInputHandleId(nodeId, `layer_${layerId}`);
      const edgesToRemove = edges.filter((e) => e.targetHandle === handleId);
      if (edgesToRemove.length > 0) {
        deleteElements({ edges: edgesToRemove });
      }
      paramsUP.order.$((order: number[]) => order.filter((_, i) => i !== idx));
    };

    return (
      <>
        <Sentence>Layers</Sentence>
        <div className="flex items-stretch">
          <div
            ref={rowsRef}
            className="flex flex-col min-w-0"
            onDragOver={handleContainerDragOver}
            onDrop={handleContainerDrop}
          >
            <div className="flex items-center gap-1 px-1 py-0.5 opacity-50 border-b border-dashed border-gray-300 mb-0.5">
              <props.InputHandle
                inputKey={addKey as any}
                position={Position.Left}
              />
              <span className="text-[10px] text-gray-400 select-none">
                + layer
              </span>
            </div>
            {params.order.map((layerId, idx) => (
              <div key={layerId}>
                <div
                  className={clsx(
                    "h-0.5 -my-0.5 relative z-10",
                    dropTarget === idx &&
                      dragIdx !== null &&
                      dragIdx !== idx &&
                      dragIdx !== idx - 1
                      ? "bg-blue-400"
                      : "bg-transparent",
                  )}
                />
                <div
                  data-layer-row
                  draggable
                  onDragStart={handleDragStart(idx)}
                  onDragEnd={handleDragEnd}
                  className={clsx(
                    "nodrag flex items-center gap-1 px-1 py-0.5 transition-colors",
                    dragIdx === idx && "opacity-40",
                  )}
                >
                  <props.InputHandle
                    inputKey={`layer_${layerId}` as any}
                    position={Position.Left}
                  />
                  {params.order.length > 1 && (
                    <button
                      onClick={handleRemove(idx)}
                      className="nodrag text-gray-300 hover:text-red-500 text-xs ml-auto leading-none"
                    >
                      ×
                    </button>
                  )}
                  <span className="text-gray-400 cursor-grab select-none text-[10px]">
                    ⠿
                  </span>
                </div>
              </div>
            ))}
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
          </div>
          <props.OutputHandle outputKey="out" />
        </div>
      </>
    );
  },
});
