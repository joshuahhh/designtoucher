import { Flow } from "./Flow.js";
import { AnyOpId } from "./ops-core.js";

export const initialFlow: Flow = {
  nodes: [
    {
      id: "n1",
      position: { x: 0, y: 0 },
      data: { opId: "cam" as AnyOpId, params: {} },
      type: "operation",
    },
    {
      id: "n2",
      position: { x: 100, y: 100 },
      data: {
        opId: "flip" as AnyOpId,
        params: {
          horizontal: true,
        },
      },
      type: "operation",
    },
  ],
  edges: [
    {
      id: "n1-n2",
      source: "n1",
      sourceHandle: "n1:output:out",
      target: "n2",
      targetHandle: "n2:input:tex1",
    },
  ],
};
