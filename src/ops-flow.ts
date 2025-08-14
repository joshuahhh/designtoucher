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
import { OmniCanvasContextType } from "./OmniCanvas.js";
import {
  AnyOp,
  AnyOpId,
  AnyOpInstance,
  instantiateOp,
  makeInputHandleId,
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

export type OpNodeData = { opId: AnyOpId; params: Record<string, any> };

export type OpNode = Node<OpNodeData, "operation">;

export function runFlow(
  nodes: OpNode[],
  edges: Edge[],
  opInstances: Record<string, AnyOpInstance>,
  ctx: OmniCanvasContextType,
  setParams: (nodeId: string, params: Record<string, any>) => void,
) {
  // clean up old op instances
  for (const [nodeId, instance] of Object.entries(opInstances)) {
    if (!nodes.some((n) => n.id === nodeId)) {
      // this is where existentials would be cute
      const op = opById(instance.opId);
      op.destroy?.({ runtime: instance.runtime, ctx });
      delete opInstances[nodeId];
    }
  }

  // create new op instances
  nodes.forEach((node) => {
    if (!opInstances[node.id]) {
      const op = opById(node.data.opId);
      opInstances[node.id] = instantiateOp(op, ctx);
      const params = node.data.params;
      setParams(node.id, params);
    }
  });

  let lateHandles = new Set<string>();
  for (const nodeId of Object.keys(opInstances)) {
    const instance = opInstances[nodeId];
    const op = opById(instance.opId);
    for (const inputKeyLate of op.inputKeysLate ?? []) {
      lateHandles.add(makeInputHandleId(nodeId, inputKeyLate));
    }
  }

  const onTimeEdges = edges.filter(
    (edge) => !lateHandles.has(edge.targetHandle!),
  );

  // toposort nodes based on edges
  const sorted = toposortFromEdges(
    nodes.map((n) => n.id),
    onTimeEdges.map((e) => [e.target, e.source]),
  );
  if (sorted.cyclic.size > 0)
    throw new Error("Cyclic dependencies detected in the flow");

  function assembleInputs(nodeId: string, onTimeOnly: boolean) {
    const inputEdges = (onTimeOnly ? onTimeEdges : edges).filter(
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
        return [inputKey, (sourceOpInstance.runtime as any)[outputKey]];
      }),
    );
  }

  // run operations in sorted order
  sorted.sorted.forEach((nodeId) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node with id ${nodeId} not found`);

    const op = opById(node.data.opId);
    const runtime = opInstances[nodeId].runtime;

    try {
      const inputs = assembleInputs(nodeId, true);
      op.run?.({
        runtime,
        inputs,
        params: node.data.params,
        ctx,
      });
      // console.log(
      //   "ran",
      //   nodeId,
      //   op.id,
      //   "from",
      //   _.mapValues(inputs, (tex) =>
      //     isProbablyTex(tex) ? getFingerprint(tex.texture) : tex,
      //   ),
      //   "to",
      //   getFingerprint(runtime.out.texture),
      // );
    } catch (error) {
      console.error(`Error running node ${nodeId}:`, error);
    }
  });

  // run all the runLate operations
  for (const [nodeId, opInstance] of Object.entries(opInstances)) {
    try {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) throw new Error(`Node with id ${nodeId} not found`);

      const op = opById(node.data.opId);

      op.runLate?.({
        runtime: opInstance.runtime,
        inputs: assembleInputs(nodeId, false),
        params: node.data.params,
        ctx,
      });
    } catch (error) {
      console.error(`Error running late for node ${nodeId}:`, error);
    }
  }
}
