import { Edge, Node } from "@xyflow/react";
import _ from "lodash";
import { assert } from "./assert.js";
import {
  deleteFbo,
  ensureFboSize,
  Fbo,
  newFbo,
  newTex,
  ShaderProgram,
  Tex,
} from "./mygl.js";
import { OmniCanvasContextType } from "./OmniCanvas.js";
import { toposortFromEdges } from "./toposort.js";
import { popFront, pushBack, pushFront } from "./util.js";
import { startStream, stopStream, WebcamStream } from "./webcam.js";

type RunProps = {
  inputs: (Tex | null)[];
  paramValues: Record<string, unknown>;
};

export type OpInstance = {
  run: (props: RunProps) => void;
  destroy: () => void;
  outputs: (Tex | null)[];
};

export type OpClass<Id extends string> = {
  id: Id;
  description: string;
  numInputs: number;
  numOutputs: number;
  params?: OpParam[];
  new (ctx: OmniCanvasContextType, nodeId: string): OpInstance;
};

function defineOp<Id extends string>(cls: OpClass<Id>) {
  return cls;
}

export type OpParam = {
  displayName: string;
  varName: string;
} & (
  | {
      type: "number";
      defaultValue: number;
      min: number;
      max: number;
      step: number;
    }
  | {
      type: "string";
      defaultValue: string;
    }
  | {
      type: "boolean";
      defaultValue: boolean;
    }
);

abstract class BaseOp {
  outputs: (Tex | null)[] = [];

  constructor(
    public ctx: OmniCanvasContextType,
    public nodeId: string,
  ) {}
}

const opWebcam = defineOp(
  class extends BaseOp {
    static id = "cam" as const;
    static description = "Camera input";
    static numInputs = 0;
    static numOutputs = 1;

    webcamStream: WebcamStream | null = null;
    tex: Tex | null = null;
    hflipOp: OpInstance;

    constructor(ctx: OmniCanvasContextType, nodeId: string) {
      super(ctx, nodeId);

      (async () => {
        // load facetime cam
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const cams = allDevices.filter((d) => d.kind === "videoinput");

        // find facetime cam
        const facetimeCam = cams.find((d) => d.label.includes("FaceTime"));
        if (!facetimeCam) {
          throw new Error("No FaceTime camera found");
        }
        this.webcamStream = await startStream(facetimeCam.deviceId, 1280);
      })();

      this.hflipOp = new opHFlip(ctx, nodeId + "-hflip");

      this.tex = newTex(this.ctx.gl, 1280, 720);

      this.outputs = [null];
    }

    run() {
      const { gl } = this.ctx;

      if (!this.webcamStream) {
        return;
      }

      if (!this.tex) {
        this.tex = newTex(
          this.ctx.gl,
          this.webcamStream.width,
          this.webcamStream.height,
        );
      }

      gl.bindTexture(gl.TEXTURE_2D, this.tex.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.webcamStream.video,
      );
      this.tex.width = this.webcamStream.width;
      this.tex.height = this.webcamStream.height;

      this.hflipOp.run({
        inputs: [this.tex],
        paramValues: {},
      });

      this.outputs = [this.hflipOp.outputs[0]];
    }

    destroy() {
      if (this.webcamStream) {
        stopStream(this.webcamStream);
        this.webcamStream = null;
      }
    }
  },
);

const opDelay = defineOp(
  class extends BaseOp {
    static id = "delay" as const;
    static description = "Delay input by some number of frames";
    static numInputs = 1;
    static numOutputs = 1;
    static params: OpParam[] = [
      {
        displayName: "Frames of delay",
        varName: "framesOfDelay",
        type: "number",
        defaultValue: 30,
        min: 1,
        max: 300,
        step: 1,
      },
    ];

    fbos: Fbo[] = [];
    outFbo: Fbo | null = null;

    run({ inputs, paramValues }: RunProps) {
      const { gl, draw } = this.ctx;
      const tex = inputs[0];
      if (!tex) {
        this.outputs = [null];
        return;
      }
      const ringLength = (paramValues["framesOfDelay"] as number) + 1;

      if (this.fbos.length < ringLength) {
        console.log("delay: lengthening ring");
        pushFront(this.fbos, newFbo(gl));
      }

      // get rid of extraneous textures
      while (this.fbos.length > ringLength) {
        console.log("delay: shortening");
        deleteFbo(popFront(this.fbos)!);
      }

      // cycle the ring
      const oldestFbo = popFront(this.fbos)!;
      ensureFboSize(oldestFbo, tex.width, tex.height);
      draw({
        texture: tex.texture,
        targetFramebuffer: oldestFbo.framebuffer,
        viewport: [0, 0, tex.width, tex.height],
      });
      pushBack(this.fbos, oldestFbo);

      if (this.fbos.length < ringLength) {
        this.outputs = [null];
        return;
        // throw new Error("Delay ring not long enough");
      }

      // TODO: ideally we'd just return this.fbos[0].tex, but this
      // glitches out... race condition? anyway let's just copy it to a
      // new FBO and avoid that trouble.
      if (!this.outFbo) {
        this.outFbo = newFbo(gl);
        ensureFboSize(this.outFbo, tex.width, tex.height);
      }
      draw({
        texture: this.fbos[0].tex.texture,
        targetFramebuffer: this.outFbo.framebuffer,
        viewport: [0, 0, tex.width, tex.height],
      });

      this.outputs = [this.outFbo.tex];
    }

    destroy() {
      this.fbos.forEach((fbo) => deleteFbo(fbo));
      if (this.outFbo) {
        deleteFbo(this.outFbo);
      }
    }
  },
);

const opFrag = defineOp(
  class extends BaseOp {
    static id = "frag" as const;
    static description = "Fragment shader operation";
    static numInputs = 1;
    static numOutputs = 1;
    static params: OpParam[] = [
      {
        displayName: "Fragment shader body",
        varName: "fragBody",
        type: "string",
        defaultValue:
          "vec3 tex1Color = vec3(texture2D(tex1, uv));\ngl_FragColor = vec4(tex1Color * 2.0, 1.0);",
      },
    ];

    compiled: {
      program: ShaderProgram;
      fragBody: string;
    } | null = null;
    outFbo: Fbo;

    constructor(ctx: OmniCanvasContextType, nodeId: string) {
      super(ctx, nodeId);
      this.outFbo = newFbo(ctx.gl);
    }

    run({ inputs, paramValues }: RunProps) {
      const { gl } = this.ctx;
      const tex = inputs[0];
      if (!tex) {
        this.outputs = [null];
        return;
      }

      const fragBody = paramValues["fragBody"] as string;
      if (!this.compiled || this.compiled.fragBody !== fragBody) {
        // compile the shader
        const fragSrc =
          `
          precision mediump float;\n` +
          `uniform sampler2D tex1;\n` +
          `varying vec2 uv;\n` +
          `void main(){\n${fragBody}\n}`;
        const vertSrc = `
          attribute vec2 position; varying vec2 uv;
          void main(){ uv = 0.5*(position+1.0); gl_Position = vec4(position,0.0,1.0); }
        `;
        this.compiled = {
          program: new ShaderProgram(gl, vertSrc, fragSrc),
          fragBody,
        };
      }

      ensureFboSize(this.outFbo, tex.width, tex.height);

      this.compiled.program.run({
        viewport: [0, 0, tex.width, tex.height],
        uniforms: { tex1: ["sampler2D", tex.texture] },
        fullscreen: true,
        targetFramebuffer: this.outFbo.framebuffer,
      });

      this.outputs = [this.outFbo.tex];
    }

    destroy() {
      deleteFbo(this.outFbo);
      this.compiled = null;
    }
  },
);

function fragOp(numInputs: number, fragBody: string, params: OpParam[] = []) {
  assert(params.every((p) => p.type === "number"));

  const fragSrc =
    `
    precision mediump float;\n` +
    params.map((p) => `uniform float ${p.varName};`).join("\n") +
    _.range(numInputs)
      .map((i) => `uniform sampler2D tex${i + 1};`)
      .join("\n") +
    `\nvarying vec2 uv;\nvoid main(){\n${fragBody}\n}
  `;

  const vertSrc = `
    attribute vec2 position; varying vec2 uv;
    void main(){ uv = 0.5*(position+1.0); gl_Position = vec4(position,0.0,1.0); }
  `;

  return class extends BaseOp {
    static numInputs = numInputs;
    static numOutputs = 1;
    static params = params;

    private program: ShaderProgram;
    private outFbo: Fbo;

    constructor(ctx: OmniCanvasContextType, nodeId: string) {
      super(ctx, nodeId);
      console.log("Creating fragOp", fragSrc);
      this.program = new ShaderProgram(ctx.gl, vertSrc, fragSrc);
      this.outFbo = newFbo(ctx.gl);
    }

    run({ inputs, paramValues }: RunProps) {
      if (inputs.some((i) => !i)) {
        this.outputs = [null];
        return;
      }

      const firstInput = inputs[0]!;
      const { width, height } = firstInput;

      ensureFboSize(this.outFbo, width, height);

      this.program.run({
        viewport: [0, 0, width, height],
        uniforms: {
          ...Object.fromEntries(
            params.map((p) => [
              p.varName,
              ["1f", Number(paramValues[p.varName] ?? 0)],
            ]),
          ),
          ...Object.fromEntries(
            inputs.map((value, i) => [
              `tex${i + 1}`,
              ["sampler2D", value!.texture],
            ]),
          ),
        },
        fullscreen: true,
        targetFramebuffer: this.outFbo.framebuffer,
      });

      this.outputs = [this.outFbo.tex];
    }

    destroy() {
      deleteFbo(this.outFbo);
    }
  };
}

const opHFlip = defineOp(
  class extends fragOp(
    1,
    `
      vec2 uvFlip = vec2(1.0 - uv.x, uv.y);
      gl_FragColor = texture2D(tex1, uvFlip);
    `,
  ) {
    static id = "hflip" as const;
    static description = "Flip image horizontally";
  },
);

const opVFlip = defineOp(
  class extends fragOp(
    1,
    `
      vec2 uvFlip = vec2(uv.x, 1.0 - uv.y);
      gl_FragColor = texture2D(tex1, uvFlip);
    `,
  ) {
    static id = "vflip" as const;
    static description = "Flip image vertically";
  },
);

const opKal = defineOp(
  class extends fragOp(
    1,
    `
      vec2 uvFlip = uv + vec2(sin(uv.y / period) * strength, cos(uv.x / period) * strength);
      gl_FragColor = texture2D(tex1, uvFlip);
    `,
    [
      {
        displayName: "Strength",
        varName: "strength",
        type: "number",
        defaultValue: 0.1,
        min: 0,
        max: 1,
        step: 0.001,
      },
      {
        displayName: "Period",
        varName: "period",
        type: "number",
        defaultValue: 0.03,
        min: 0,
        max: 0.5,
        step: 0.001,
      },
    ],
  ) {
    static id = "kal" as const;
    static description = "Kaleidoscope effect";
  },
);

const opMinus = defineOp(
  class extends fragOp(
    2,
    `
      vec3 tex1Color = vec3(texture2D(tex1, uv));
      vec3 tex2Color = vec3(texture2D(tex2, uv));
      gl_FragColor = vec4(tex1Color - tex2Color, 1.0);
    `,
  ) {
    static id = "minus" as const;
    static description = "Subtract two images";
  },
);

const opTimes = defineOp(
  class extends fragOp(
    1,
    `
      vec3 tex1Color = vec3(texture2D(tex1, uv));
      gl_FragColor = vec4(tex1Color * alpha, 1.0);
    `,
    [
      {
        displayName: "Alpha",
        varName: "alpha",
        type: "number",
        defaultValue: 1,
        min: 0,
        max: 10,
        step: 0.01,
      },
    ],
  ) {
    static id = "times" as const;
    static description = "Multiply image by number";
  },
);

export const ops = [
  opWebcam,
  opDelay,
  opHFlip,
  opVFlip,
  opKal,
  opMinus,
  opTimes,
  opFrag,
] as const;

export type AnyOpId = (typeof ops)[number]["id"];

export function opById(id: string): OpClass<AnyOpId> {
  const found = ops.find((op) => op.id === id);
  if (!found) {
    throw new Error(`Operation with id ${id} not found`);
  }
  return found;
}

export type OpNode = Node<
  { opId: AnyOpId; paramValues: Record<string, any> },
  "operation"
>;

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

export function defaultParamValues(opId: AnyOpId): Record<string, any> {
  const op = opById(opId);
  if (!op.params) return {};

  return Object.fromEntries(
    op.params.map((param) => {
      return [param.varName, param.defaultValue];
    }),
  );
}

export function runFlow(
  nodes: OpNode[],
  edges: Edge[],
  runtimes: Record<string, OpInstance>,
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
      runtimes[node.id] = new op(ctx, node.id);
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
        return null;
      }
      return runtimes[edge.source].outputs[
        outputHandleToIdx(edge.sourceHandle)
      ];
    });

    try {
      runtime.run({ inputs, paramValues: node.data.paramValues });
    } catch (error) {
      console.error(`Error running node ${nodeId}:`, error);
    }
  });
}
