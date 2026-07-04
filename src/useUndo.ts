import { Edge } from "@xyflow/react";
import { Dispatch, SetStateAction, useCallback, useRef } from "react";
import { Flow } from "./Flow.js";
import { useRefForCallback } from "./useRefForCallback.js";

type FlowNode = Flow["nodes"][number];

export type FlowSnapshot = {
  nodes: FlowNode[];
  edges: Edge[];
};

const MAX_HISTORY = 100;

function snapshotFromFlow(flow: Flow): FlowSnapshot {
  return { nodes: flow.nodes, edges: flow.edges };
}

export function useUndo(flow: Flow, setFlow: Dispatch<SetStateAction<Flow>>) {
  const pastRef = useRef<FlowSnapshot[]>([]);
  const futureRef = useRef<FlowSnapshot[]>([]);
  // Stable callbacks: anything that depends on `flow` directly gets rebuilt on
  // every flow change, which re-triggers effects that list these as deps.
  const flowRef = useRefForCallback(flow);

  const pushSnapshot = useCallback((snapshot: FlowSnapshot) => {
    pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), snapshot];
    futureRef.current = [];
  }, []);

  const takeSnapshot = useCallback(() => {
    pushSnapshot(snapshotFromFlow(flowRef.current));
  }, [flowRef, pushSnapshot]);

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    pastRef.current = past.slice(0, -1);
    futureRef.current = [
      ...futureRef.current,
      snapshotFromFlow(flowRef.current),
    ];

    setFlow((prev) => ({
      ...prev,
      nodes: previous.nodes,
      edges: previous.edges,
    }));
  }, [flowRef, setFlow]);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) return;

    const next = future[future.length - 1];
    futureRef.current = future.slice(0, -1);
    pastRef.current = [...pastRef.current, snapshotFromFlow(flowRef.current)];

    setFlow((prev) => ({
      ...prev,
      nodes: next.nodes,
      edges: next.edges,
    }));
  }, [flowRef, setFlow]);

  return { takeSnapshot, pushSnapshot, undo, redo };
}
