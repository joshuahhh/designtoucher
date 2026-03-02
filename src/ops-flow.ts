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
import { destroyFbo, ensureFboSize, Fbo, newFbo, Tex } from "./mygl.js";
import { OmniCanvasContextType } from "./OmniCanvas.js";
import {
  AnyOp,
  AnyOpId,
  AnyOpInstance,
  makeInputHandleId,
  makeOutputHandleId,
  Op,
  OpInstance,
  parseInputHandleId,
  parseOutputHandleId,
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
      const params = node.data.params;
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
      (e) => e.target === nodeId,
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
        return [inputKey, sourceOpInstance.runtime[outputKey] as Tex | null];
      }),
    );
  }

  // run operations in sorted order
  sorted.sorted.forEach((nodeId) => {
    const node = augNodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node with id ${nodeId} not found`);

    const instance = opInstances[nodeId];

    try {
      const inputs = assembleInputs(nodeId, true);
      instance.run({ inputs, params: node.data.params, ctx });
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
        params: node.data.params,
        ctx,
      });
    } catch (error) {
      console.error(`Error running late for node ${nodeId}:`, error);
    }
  }

  return instancesChanged;
}
