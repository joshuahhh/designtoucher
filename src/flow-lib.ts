import { Edge, Node } from "@xyflow/react";
import _ from "lodash";
import {
  CommandRunner,
  CommandRunnerDelay,
  CommandRunnerFlip,
  CommandRunnerKal,
  CommandRunnerMinus,
} from "./commands.js";
import { newTex, Tex } from "./mygl.js";
import { OmniCanvasContextType } from "./OmniCanvas.js";
import { toposortFromEdges } from "./toposort.js";
import { startStream, stopStream, WebcamStream } from "./webcam.js";

export type OpRuntime = {
  run: (props: { inputs: (Tex | undefined)[] }) => void;
  destroy: () => void;
  getOutputs: () => Tex[];
};

export type Op<Id extends string, OR extends OpRuntime> = {
  id: Id;
  numInputs: number;
  numOutputs: number;
  makeRuntime: (ctx: OmniCanvasContextType, nodeId: string) => OR;
};

function makeOp<Id extends string, OR extends OpRuntime>(
  op: Op<Id, OR>,
): Op<Id, OR> {
  return op;
}

const webcamOperation = makeOp({
  id: "webcam" as const,
  numInputs: 0,
  numOutputs: 1,
  makeRuntime: (ctx, nodeId) => {
    const { gl } = ctx;

    let webcamStream: WebcamStream | null = null;
    (async () => {
      // load facetime cam
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const cams = allDevices.filter((d) => d.kind === "videoinput");

      // find facetime cam
      const facetimeCam = cams.find((d) => d.label.includes("FaceTime"));
      if (!facetimeCam) {
        throw new Error("No FaceTime camera found");
      }
      webcamStream = await startStream(facetimeCam.deviceId, 1280);
    })();

    let tex: Tex | null = null;

    return {
      run: () => {
        if (!webcamStream) {
          return;
        }

        if (!tex) {
          tex = newTex(gl, webcamStream.width, webcamStream.height);
        }

        gl.bindTexture(gl.TEXTURE_2D, tex.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          webcamStream.video,
        );
        tex.width = webcamStream.width;
        tex.height = webcamStream.height;
      },
      destroy: () => {
        console.log("Destroying webcam operation", nodeId);
        if (webcamStream) {
          stopStream(webcamStream);
          webcamStream = null;
        }
      },
      getOutputs: () => [tex!],
    };
  },
});

function makeOpFromCR(
  id: string,
  makeCR: (ctx: OmniCanvasContextType) => CommandRunner,
  numInputs: number,
) {
  return makeOp({
    id,
    numInputs,
    numOutputs: 1,
    makeRuntime: (ctx, nodeId) => {
      const cr = makeCR(ctx);
      let output: Tex | null = null;
      return {
        run: ({ inputs }) => {
          if (inputs.some((i) => !i)) {
            output = null;
          } else {
            output = hackyRunCommandRunner(cr, inputs as Tex[]);
          }
        },
        destroy: () => {
          console.log("Destroying command runner operation", nodeId);
        },
        getOutputs: () => [output!],
      };
    },
  });
}

// const flip = makeOp({
//   id: "flip" as const,
//   numInputs: 1,
//   numOutputs: 1,
//   makeRuntime: (ctx, nodeId) => {
//     const cr = new CommandRunnerFlip({
//       ctx,
//       command: undefined!,
//       id: undefined!,
//       parameterValues: {},
//     });
//     let output: Tex | null = null;

//     return {
//       run: ({ inputs }) => {
//         // console.log("Running flip operation", nodeId);
//         // Implement flip logic here
//         console.log("Running flip operation", nodeId, inputs);
//         if (!inputs[0]) {
//           output = null;
//         } else {
//           output = hackyRunCommandRunner(cr, inputs as Tex[]);
//         }
//       },
//       destroy: () => {
//         console.log("Destroying flip operation", nodeId);
//       },
//       getOutputs: () => [output!],
//     };
//   },
// });

const flip = makeOpFromCR(
  "flip",
  (ctx) =>
    new CommandRunnerFlip({
      ctx,
      command: undefined!,
      id: undefined!,
      parameterValues: {},
    }),
  1,
);

const kal = makeOpFromCR(
  "kal",
  (ctx) =>
    new CommandRunnerKal({
      ctx,
      command: undefined!,
      id: undefined!,
      parameterValues: {},
    }),
  1,
);

const delay = makeOpFromCR(
  "delay",
  (ctx) =>
    new CommandRunnerDelay({
      ctx,
      command: undefined!,
      id: undefined!,
      parameterValues: {
        Length: 30,
      },
    }),
  1,
);

const minus = makeOpFromCR(
  "minus",
  (ctx) =>
    new CommandRunnerMinus({
      ctx,
      command: undefined!,
      id: undefined!,
      parameterValues: {},
    }),
  2,
);

const ops = [webcamOperation, flip, kal, delay, minus];

type AnyOpId = (typeof ops)[number]["id"];

export function opById(id: string): Op<AnyOpId, OpRuntime> {
  const found = ops.find((op) => op.id === id);
  if (!found) {
    throw new Error(`Operation with id ${id} not found`);
  }
  return found;
}

export type OpNode = Node<{ opId: AnyOpId }, "operation">;

export function idxToOutputHandle(idx: number): string {
  return `output-${idx + 1}`;
}
export function idxToInputHandle(idx: number): string {
  return `input-${idx + 1}`;
}
export function outputHandleToIdx(handle: string | null | undefined): number {
  if (!handle?.startsWith("output-")) {
    throw new Error(`Invalid output handle: ${handle}`);
  }
  return parseInt(handle.slice("output-".length)) - 1;
}
export function inputHandleToIdx(handle: string | null | undefined): number {
  if (!handle?.startsWith("input-")) {
    throw new Error(`Invalid input handle: ${handle}`);
  }
  return parseInt(handle.slice("input-".length)) - 1;
}

export function runFlow(
  nodes: OpNode[],
  edges: Edge[],
  runtimes: Record<string, OpRuntime>,
  ctx: OmniCanvasContextType,
) {
  // clean up old runtimes
  for (const id in runtimes) {
    if (!nodes.some((n) => n.id === id)) {
      runtimes[id].destroy();
      delete runtimes[id];
    }
  }

  // create new runtimes
  nodes.forEach((node) => {
    if (!runtimes[node.id]) {
      const op = opById(node.data.opId);
      runtimes[node.id] = op.makeRuntime(ctx, node.id);
    }
  });

  // toposort nodes based on edges
  const sorted = toposortFromEdges(
    nodes.map((n) => n.id),
    edges.map((e) => [e.target, e.source]),
  );
  if (sorted.cyclic.size > 0)
    throw new Error("Cyclic dependencies detected in the flow");

  // run operations in sorted order
  sorted.sorted.forEach((nodeId) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node with id ${nodeId} not found`);

    const op = opById(node.data.opId);
    const runtime = runtimes[nodeId];

    const inputs = _.range(op.numInputs).map((i) => {
      const edge = edges.find(
        (e) => e.target === nodeId && e.targetHandle === idxToInputHandle(i),
      );
      if (!edge) {
        return undefined;
      }
      return runtimes[edge.source].getOutputs()[
        outputHandleToIdx(edge.sourceHandle)
      ];
    });

    runtime.run({ inputs });
  });
}

export function hackyRunCommandRunner(
  cr: CommandRunner,
  inputs: Tex[],
): Tex | null {
  const newState = cr.run({
    type: "active",
    vars: {},
    stack: inputs.map((tex) => ({
      type: "texture",
      tex,
    })),
    intermediate: {},
  });
  if (newState.type === "error") {
    // TODO: error reporting
    return null;
  }
  return newState.stack.at(-1)!.tex;
}
