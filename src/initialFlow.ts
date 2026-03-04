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
  ],
  edges: [],
};
