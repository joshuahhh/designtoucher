import { Edge } from "@xyflow/react";
import { Dispatch, SetStateAction, useCallback, useRef } from "react";
import { Flow } from "./Flow.js";

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

  const pushSnapshot = useCallback((snapshot: FlowSnapshot) => {
    pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), snapshot];
    futureRef.current = [];
  }, []);

  const takeSnapshot = useCallback(() => {
    pushSnapshot(snapshotFromFlow(flow));
  }, [flow, pushSnapshot]);

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    pastRef.current = past.slice(0, -1);
    futureRef.current = [...futureRef.current, snapshotFromFlow(flow)];

    setFlow((prev) => ({
      ...prev,
      nodes: previous.nodes,
      edges: previous.edges,
    }));
  }, [flow, setFlow]);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) return;

    const next = future[future.length - 1];
    futureRef.current = future.slice(0, -1);
    pastRef.current = [...pastRef.current, snapshotFromFlow(flow)];

    setFlow((prev) => ({
      ...prev,
      nodes: next.nodes,
      edges: next.edges,
    }));
  }, [flow, setFlow]);

  return { takeSnapshot, pushSnapshot, undo, redo };
}
