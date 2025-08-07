import { Flow } from "./Flow.js";

export const initialFlow: Flow = {
  nodes: [
    {
      id: "n1",
      position: { x: 0, y: 0 },
      data: { opId: "cam", paramValues: {} },
      type: "operation",
    },
    {
      id: "n2",
      position: { x: 100, y: 100 },
      data: { opId: "kal", paramValues: {} },
      type: "operation",
    },
  ],
  edges: [
    {
      id: "n1-n2",
      source: "n1",
      sourceHandle: "output-1",
      target: "n2",
      targetHandle: "input-1",
    },
  ],
};
