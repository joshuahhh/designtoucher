// export const opsInGroups = [
//   ["Sources", [opWebcam, opVideo, opRemoteCam]],
//   ["Generators", [opLFO, opGradient, opBlack, opSNoise]],
//   ["Space", [opHFlip, opVFlip, opKal, opDisplace]],
//   ["Color", [opSteps]],
//   ["Combiners", [opLayer, opSwitch, opMinus, opPlus, opBlend, opTimes]],
//   ["Time", [opFeedbackBuffer, opDelay, opTimeMachine, opMedian, opMedianOld]],
//   ["Power", [opFrag]],
// ] as const;

import { Edge, Node } from "@xyflow/react";
import {
  destroyFbo,
  ensureFboSize,
  Fbo,
  isProbablyTex,
  newFbo,
  Tex,
} from "./mygl.js";
import { OmniCanvasContextType } from "./OmniCanvas.js";
import {
  AnyOp,
  AnyOpId,
  AnyOpInstance,
  isParamHandleId,
  makeInputHandleId,
  makeOutputHandleId,
  Op,
  OpInstance,
  parseInputHandleId,
  parseOutputHandleId,
  parseParamHandleId,
} from "./ops-core.js";
import { ops } from "./ops/all-the-ops.js";
import { toposortFromEdges } from "./toposort.js";

export function opById(id: string): AnyOp {
  const found = ops.find((op) => op.id === id);
  if (!found) {
    throw new Error(`Operation with id ${id} not found`);
  }
  return found;
}

export function instantiateOp<
  Runtime extends Record<string, unknown>,
  InputKey extends string,
  Params extends Record<string, unknown>,
>(
  op: Op<Runtime, InputKey, Params>,
  ctx: OmniCanvasContextType,
  getOpStrategy: "get-op-by-id" | "constant-op",
): OpInstance<Runtime, InputKey, Params> {
  return new OpInstance(
    getOpStrategy === "get-op-by-id"
      ? () => opById(op.id) as any as Op<Runtime, InputKey, Params>
      : () => op,
    ctx,
  );
}

export type OpNodeData = { opId: AnyOpId; params: Record<string, unknown> };

export type OpNode = Node<OpNodeData, "operation">;

/**
 * Wire type coming out of an output handle. Anything unresolvable (picker
 * handles, missing nodes) is treated as "tex", the historical default.
 */
export function outputTypeForHandle(
  nodes: Node[],
  sourceHandle: string | null | undefined,
): "tex" | "number" {
  if (!sourceHandle) return "tex";
  let parsed;
  try {
    parsed = parseOutputHandleId(sourceHandle);
  } catch {
    return "tex";
  }
  const node = nodes.find((n) => n.id === parsed.nodeId);
  if (!node || node.type !== "operation") return "tex";
  try {
    const op = opById((node as OpNode).data.opId);
    return op.outputTypes?.[parsed.key] ?? "tex";
  } catch {
    return "tex";
  }
}

/**
 * Type-check a candidate connection: number outputs only land on param
 * handles, texture outputs only on input handles. (No coercion for now.)
 */
export function isCompatibleConnection(
  nodes: Node[],
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
): boolean {
  const sourceType = outputTypeForHandle(nodes, sourceHandle);
  return isParamHandleId(targetHandle)
    ? sourceType === "number"
    : sourceType === "tex";
}

// Implicit op that sums N input textures using additive GL blending.
const implicitSumOp: AnyOp = {
  id: "_implicit-sum",
  initRuntime(ctx) {
    const fbo = newFbo(ctx.gl);
    return { out: fbo.tex, _fbo: fbo };
  },
  run({ runtime, inputs, ctx }) {
    const textures = Object.values(inputs).filter((t): t is Tex => t !== null);
    if (textures.length === 0) return;

    const fbo = runtime._fbo as Fbo;
    const { gl } = ctx;
    const w = textures[0].width;
    const h = textures[0].height;
    ensureFboSize(fbo, w, h);
    runtime.out = fbo.tex;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
    for (const tex of textures) {
      ctx.draw({
        tex,
        targetFramebuffer: fbo.framebuffer,
        viewport: [0, 0, w, h],
      });
    }
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
  destroy({ runtime }) {
    destroyFbo(runtime._fbo as Fbo);
  },
  Render: () => null,
};

/**
 * Detect multi-edges (multiple sources → same target handle) and insert
 * implicit sum nodes so each real input sees a single summed texture.
 */
function augmentForMultiEdges(nodes: OpNode[], edges: Edge[]) {
  const augNodes = [...nodes];
  const augEdges: Edge[] = [];
  const implicitNodeIds = new Set<string>();

  // Group edges by target handle
  const byTargetHandle = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = edge.targetHandle!;
    let group = byTargetHandle.get(key);
    if (!group) {
      group = [];
      byTargetHandle.set(key, group);
    }
    group.push(edge);
  }

  for (const [targetHandle, group] of byTargetHandle) {
    // A param handle takes a single driver — replace-on-connect keeps it that
    // way, but if a stale file has several, the newest edge wins.
    if (isParamHandleId(targetHandle)) {
      augEdges.push(group[group.length - 1]);
      continue;
    }
    if (group.length <= 1) {
      augEdges.push(...group);
      continue;
    }

    const { nodeId: targetNodeId, key: inputKey } =
      parseInputHandleId(targetHandle);
    const implicitId = `__sum_${targetNodeId}_${inputKey}`;
    implicitNodeIds.add(implicitId);

    augNodes.push({
      id: implicitId,
      type: "operation",
      position: { x: 0, y: 0 },
      data: { opId: "_implicit-sum" as AnyOpId, params: {} },
    } as OpNode);

    group.forEach((edge, i) => {
      augEdges.push({
        ...edge,
        id: `${edge.id}__to_sum`,
        target: implicitId,
        targetHandle: makeInputHandleId(implicitId, `in${i}`),
      });
    });

    augEdges.push({
      id: `__sum_edge_${implicitId}`,
      source: implicitId,
      sourceHandle: makeOutputHandleId(implicitId, "out"),
      target: targetNodeId,
      targetHandle,
    });
  }

  return { augNodes, augEdges, implicitNodeIds };
}

export function runFlow(
  nodes: OpNode[],
  edges: Edge[],
  opInstances: Record<string, AnyOpInstance>,
  ctx: OmniCanvasContextType,
  setParams: (nodeId: string, params: Record<string, any>) => void,
): boolean {
  let instancesChanged = false;

  // Augment graph: insert implicit sum nodes for multi-edge inputs
  const { augNodes, augEdges, implicitNodeIds } = augmentForMultiEdges(
    nodes,
    edges,
  );

  // clean up old op instances (check against augmented node list)
  for (const [nodeId, instance] of Object.entries(opInstances)) {
    if (!augNodes.some((n) => n.id === nodeId)) {
      instance.destroy?.({ ctx });
      delete opInstances[nodeId];
      instancesChanged = true;
    }
  }

  // create new real op instances
  nodes.forEach((node) => {
    if (!opInstances[node.id]) {
      const op = opById(node.data.opId);
      opInstances[node.id] = instantiateOp(op, ctx, "get-op-by-id");
      // Backfill params the op has grown since this node was saved, so a
      // redefined op doesn't see undefined params.
      const params = { ...op.initParams?.(), ...node.data.params };
      setParams(node.id, params);
      instancesChanged = true;
    }
  });

  // create new implicit sum instances
  for (const id of implicitNodeIds) {
    if (!opInstances[id]) {
      opInstances[id] = instantiateOp(implicitSumOp, ctx, "constant-op");
      instancesChanged = true;
    }
  }

  let lateHandles = new Set<string>();
  for (const nodeId of Object.keys(opInstances)) {
    if (implicitNodeIds.has(nodeId)) continue;
    const instance = opInstances[nodeId];
    const op = instance.getOp();
    for (const inputKeyLate of op.inputKeysLate ?? []) {
      lateHandles.add(makeInputHandleId(nodeId, inputKeyLate));
    }
  }

  const augOnTimeEdges = augEdges.filter(
    (edge) => !lateHandles.has(edge.targetHandle!),
  );

  // toposort nodes based on augmented edges
  const sorted = toposortFromEdges(
    augNodes.map((n) => n.id),
    augOnTimeEdges.map((e) => [e.target, e.source]),
  );
  if (sorted.cyclic.size > 0)
    throw new Error("Cyclic dependencies detected in the flow");

  function assembleInputs(nodeId: string, onTimeOnly: boolean) {
    const inputEdges = (onTimeOnly ? augOnTimeEdges : augEdges).filter(
      (e) => e.target === nodeId && !isParamHandleId(e.targetHandle),
    );

    return Object.fromEntries(
      inputEdges.map((edge) => {
        const { nodeId, key: outputKey } = parseOutputHandleId(
          edge.sourceHandle!,
        );
        const { key: inputKey } = parseInputHandleId(edge.targetHandle!);

        const sourceOpInstance = opInstances[nodeId];
        if (!sourceOpInstance) {
          console.warn(
            `Source op instance ${edge.source} not found for edge`,
            edge,
          );
          return [inputKey, null];
        }
        const value = sourceOpInstance.getRuntime()?.[outputKey];
        // Guard against non-texture outputs wired into a texture input (e.g.
        // a stale saved graph from before an op's output became a number).
        return [inputKey, isProbablyTex(value) ? value : null];
      }),
    );
  }

  // Resolve params for a node: the stored constants, overridden by the live
  // value of any number wire landing on a param handle. Sources ran earlier
  // this frame (param edges participate in the toposort), so values are fresh.
  function assembleParams(node: OpNode): Record<string, unknown> {
    let params = node.data.params;
    for (const edge of augEdges) {
      if (edge.target !== node.id || !isParamHandleId(edge.targetHandle))
        continue;
      const { key: paramKey } = parseParamHandleId(edge.targetHandle);
      const { nodeId: sourceNodeId, key: outputKey } = parseOutputHandleId(
        edge.sourceHandle!,
      );
      const value = opInstances[sourceNodeId]?.getRuntime()?.[outputKey];
      if (typeof value === "number") {
        if (params === node.data.params) params = { ...params };
        params[paramKey] = value;
      }
    }
    return params;
  }

  // run operations in sorted order
  sorted.sorted.forEach((nodeId) => {
    const node = augNodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node with id ${nodeId} not found`);

    const instance = opInstances[nodeId];

    try {
      const inputs = assembleInputs(nodeId, true);
      instance.run({ inputs, params: assembleParams(node), ctx });
    } catch (error) {
      console.error(`Error running node ${nodeId}:`, error);
    }
  });

  // run all the runLate operations (skip implicit nodes, they have no runLate)
  for (const [nodeId, opInstance] of Object.entries(opInstances)) {
    if (implicitNodeIds.has(nodeId)) continue;
    try {
      const node = augNodes.find((n) => n.id === nodeId);
      if (!node) throw new Error(`Node with id ${nodeId} not found`);

      opInstance.runLate({
        inputs: assembleInputs(nodeId, false),
        params: assembleParams(node),
        ctx,
      });
    } catch (error) {
      console.error(`Error running late for node ${nodeId}:`, error);
    }
  }

  return instancesChanged;
}

export type HandleBounds = {
  source: Array<{
    id?: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
  }> | null;
  target: Array<{
    id?: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
  }> | null;
};

/**
 * Compute ephemeral "proximity" edges using "grabby input" logic:
 *
 * Each node has at most one grabby input — the first tex input with no real
 * edge connected. That input reaches out and grabs the nearest tex output
 * handle (on a different node) within MAX_DISTANCE, measured handle-to-handle.
 */
export function computeProximityEdges(
  nodes: OpNode[],
  realEdges: Edge[],
  getHandleBounds: (nodeId: string) => HandleBounds | undefined,
): Edge[] {
  const MAX_DISTANCE = 100;

  const proximityEdges: Edge[] = [];

  const connectedInputs = new Set<string>();
  for (const e of realEdges) {
    if (e.targetHandle && !isParamHandleId(e.targetHandle)) {
      connectedInputs.add(e.targetHandle);
    }
  }

  type Rect = { x: number; y: number; w: number; h: number };

  function handleAbsRect(
    node: OpNode,
    handle: { x: number; y: number; width: number; height: number },
  ): Rect {
    const nw = node.measured?.width ?? 160;
    const nh = node.measured?.height ?? 60;
    return {
      x: node.position.x - nw / 2 + handle.x,
      y: node.position.y - nh / 2 + handle.y,
      w: handle.width,
      h: handle.height,
    };
  }

  function rectToRectDist(a: Rect, b: Rect): number {
    const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
    const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
    return Math.sqrt(dx * dx + dy * dy);
  }

  const defaultRect = (node: OpNode): Rect => ({
    x: node.position.x,
    y: node.position.y,
    w: 0,
    h: 0,
  });

  // Pre-collect all tex output handles with their absolute rects
  const outputHandles: Array<{
    node: OpNode;
    handleId: string;
    rect: Rect;
  }> = [];
  for (const node of nodes) {
    const op = opById(node.data.opId);
    const outputKeys = op.outputKeys ?? ["out"];
    const bounds = getHandleBounds(node.id);
    for (const key of outputKeys) {
      const outputType = op.outputTypes?.[key] ?? "tex";
      if (outputType !== "tex") continue;
      const handleId = makeOutputHandleId(node.id, key);
      const bound = bounds?.source?.find((h) => h.id === handleId);
      outputHandles.push({
        node,
        handleId,
        rect: bound ? handleAbsRect(node, bound) : defaultRect(node),
      });
    }
  }

  for (const target of nodes) {
    const targetOp = opById(target.data.opId);
    const allInputKeys = targetOp.inputKeys ?? [];

    // Find the first unconnected tex input — the grabby input
    let grabbyKey: string | undefined;
    for (const key of allInputKeys) {
      const handleId = makeInputHandleId(target.id, key);
      if (!connectedInputs.has(handleId)) {
        grabbyKey = key;
        break;
      }
    }
    if (!grabbyKey) continue;

    const targetHandleId = makeInputHandleId(target.id, grabbyKey);
    const targetBounds = getHandleBounds(target.id);
    const targetBound = targetBounds?.target?.find(
      (h) => h.id === targetHandleId,
    );
    const targetRect = targetBound
      ? handleAbsRect(target, targetBound)
      : defaultRect(target);

    let bestOutput: (typeof outputHandles)[number] | null = null;
    let bestDist = Infinity;

    for (const output of outputHandles) {
      if (output.node.id === target.id) continue;

      const dist = rectToRectDist(targetRect, output.rect);

      if (dist < MAX_DISTANCE && dist < bestDist) {
        bestDist = dist;
        bestOutput = output;
      }
    }

    if (!bestOutput) continue;

    const candidateEdge: Edge = {
      id: `__proximity_${bestOutput.node.id}_${target.id}`,
      source: bestOutput.node.id,
      target: target.id,
      sourceHandle: bestOutput.handleId,
      targetHandle: targetHandleId,
      type: "proximity",
      data: {
        proximity: true,
        sourceHandle: bestOutput.handleId,
        targetHandle: targetHandleId,
      },
    };

    const allEdges = [...realEdges, ...proximityEdges, candidateEdge];
    const lateHandles = new Set<string>();
    for (const n of nodes) {
      const op = opById(n.data.opId);
      for (const k of op.inputKeysLate ?? []) {
        lateHandles.add(makeInputHandleId(n.id, k));
      }
    }
    const onTimeEdges = allEdges.filter(
      (e) => !lateHandles.has(e.targetHandle!),
    );
    const nodeIds = nodes.map((n) => n.id);
    const edgePairs = onTimeEdges.map(
      (e) => [e.target, e.source] as [string, string],
    );
    const sorted = toposortFromEdges(nodeIds, edgePairs);
    if (sorted.cyclic.size > 0) continue;

    proximityEdges.push(candidateEdge);
  }

  return proximityEdges;
}
