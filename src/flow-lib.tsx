import { UpdateProxy } from "@engraft/update-proxy";
import { Slider, Tooltip } from "@radix-ui/themes";
import { Edge, Handle, Node, NodeProps, Position } from "@xyflow/react";
import clsx from "clsx";
import _ from "lodash";
import { ReactNode } from "react";
import { assert } from "./assert.js";
import {
  deleteFbo,
  destroyTex3D,
  ensureFboSize,
  Fbo,
  newFbo,
  newTex,
  newTex3D,
  ShaderProgram,
  Tex,
  Tex3D,
} from "./mygl.js";
import { OmniCanvasContextType } from "./OmniCanvas.js";
import { toposortFromEdges } from "./toposort.js";
import { popFront, pushBack, pushFront } from "./util.js";
import { startStream, stopStream, WebcamStream } from "./webcam.js";

type RunProps = {
  inputs: (Tex | null)[];
  paramValues: Record<string, unknown>;
};

type TopProps = NodeProps<OpNode> & {
  paramValuesUP: UpdateProxy<Record<string, unknown>>;
  instance: BaseOp;
};

export type OpClass<Id extends string> = {
  id: Id;
  description: string;
  new (ctx: OmniCanvasContextType, nodeId: string): BaseOp;
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

export abstract class BaseOp {
  outputs: (Tex | null)[] = [];

  constructor(
    public ctx: OmniCanvasContextType,
    public nodeId: string,
  ) {}
  abstract run(props: RunProps): void;
  abstract destroy(): void;
  abstract numInputs: number;
  abstract numOutputs: number;
  params?: OpParam[] | undefined;
  renderTop?(props: TopProps): ReactNode;

  getParamValue(paramValues: Record<string, any>, paramName: string): any {
    const value = paramValues[paramName];
    if (value !== undefined) {
      return value;
    }

    const param = this.params?.find((p) => p.varName === paramName);
    if (param) {
      return param.defaultValue;
    }

    throw new Error(`Parameter ${paramName} not found`);
  }
}

const opWebcam = defineOp(
  class extends BaseOp {
    static id = "cam" as const;
    static description = "Camera input";
    numInputs = 0;
    numOutputs = 1;
    params: OpParam[] = [
      {
        displayName: "Flip horizontally",
        varName: "hflip",
        type: "boolean",
        defaultValue: true,
      },
    ];

    webcamStream: WebcamStream | null = null;
    tex: Tex | null = null;
    hflipOp: BaseOp | null = null;

    constructor(ctx: OmniCanvasContextType, nodeId: string) {
      super(ctx, nodeId);

      (async () => {
        // gotta do this first on Safari

        if (!navigator.mediaDevices) {
          throw new Error(
            "navigator.mediaDevices not available; are we in a SECURE CONTEXT, like a bunch of goddamned SECRET AGENTS?",
          );
        }

        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
          });
          stream.getTracks().forEach((track) => track.stop());
        } catch (e) {
          // ignore
          console.log("Ignoring getUserMedia error:", e);
        }

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const cams = allDevices.filter((d) => d.kind === "videoinput");

        // find facetime cam
        let camToUse = cams.find((d) => d.label.includes("FaceTime"));
        // const facetimeCam = cams.find((d) => d.label.includes("OBS"));
        if (!camToUse) {
          console.warn("No FaceTime camera found, using first video input");
          if (cams.length === 0) {
            throw new Error("No video input devices found");
          }
          camToUse = cams[0];
        }

        this.webcamStream = await startStream(camToUse.deviceId, 1920);
        console.log("Z");

        console.log(
          "Webcam stream started",
          this.webcamStream.width,
          this.webcamStream.height,
        );
      })();

      this.outputs = [null];
    }

    run({ paramValues }: RunProps) {
      const { gl } = this.ctx;

      if (!this.webcamStream) {
        return;
      }

      if (!this.tex) {
        console.log(
          "Creating new texture for webcam stream",
          this.webcamStream.width,
          this.webcamStream.height,
        );
        this.tex = newTex(
          this.ctx.gl,
          this.webcamStream.width,
          this.webcamStream.height,
        );
      }

      gl.bindTexture(gl.TEXTURE_2D, this.tex.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      // console.log("BEFORE texSubImage2D");
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.webcamStream.video,
      );
      // console.log("AFTER texSubImage2D");
      this.tex.width = this.webcamStream.width;
      this.tex.height = this.webcamStream.height;

      if (this.getParamValue(paramValues, "hflip")) {
        if (!this.hflipOp) {
          this.hflipOp = new opHFlip(this.ctx, this.nodeId + "-hflip");
        }

        this.hflipOp.run({
          inputs: [this.tex],
          paramValues: {},
        });

        this.outputs = [this.hflipOp.outputs[0]];
      } else {
        if (this.hflipOp) {
          this.hflipOp.destroy();
          this.hflipOp = null;
        }

        this.outputs = [this.tex];
      }
    }

    destroy() {
      if (this.webcamStream) {
        stopStream(this.webcamStream);
        this.webcamStream = null;
      }
    }

    renderTop(props: NodeProps<OpNode>) {
      return (
        <div className="text-xs">
          Use input{" "}
          <span className="underline decoration-dotted">FaceTime camera</span>
        </div>
      );
    }
  },
);

const opDelay = defineOp(
  class extends BaseOp {
    static id = "delay" as const;
    static description = "Delay input by some number of frames";
    numInputs = 1;
    numOutputs = 1;
    params: OpParam[] = [
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
      const ringLength =
        (this.getParamValue(paramValues, "framesOfDelay") as number) + 1;

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

    renderTop(props: TopProps) {
      return <OpDelay {...props} instance={this} />;
    }
  },
);

const OpDelay = (props: TopProps) => {
  const { data, instance, paramValuesUP } = props;

  return (
    <div className="text-xs">
      Delay <SentenceHandle idx={0} /> by{" "}
      <SentenceParam
        varName="framesOfDelay"
        instance={instance}
        paramValues={data.paramValues}
        paramValuesUP={paramValuesUP}
      />{" "}
      frames
    </div>
  );
};

const opFrag = defineOp(
  class extends BaseOp {
    static id = "frag" as const;
    static description = "Fragment shader operation";
    numInputs = 1;
    numOutputs = 1;
    params: OpParam[] = [
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

      const fragBody = this.getParamValue(paramValues, "fragBody") as string;

      const hasTime = fragBody.includes("time");

      if (!this.compiled || this.compiled.fragBody !== fragBody) {
        // compile the shader
        const fragSrc =
          `precision mediump float;\n` +
          `uniform sampler2D tex1;\n` +
          (hasTime ? `uniform float time;\n` : "") +
          `varying vec2 uv;\n` +
          `// lygia-includes\n` +
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
        uniforms: {
          tex1: ["sampler2D", tex.texture],
          ...(hasTime ? { time: ["1f", performance.now() / 1000] } : {}),
        },
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

const opTimeMachine = defineOp(
  class extends BaseOp {
    static id = "timeMachine" as const;
    static description = "Time machine operation";
    numInputs = 2;
    numOutputs = 1;
    params: OpParam[] = [
      {
        displayName: "Number of frames",
        varName: "numFrames",
        type: "number",
        min: 1,
        max: 200,
        step: 1,
        defaultValue: 100,
      },
    ];

    private frames: Tex3D;
    private head: number = 0;
    private fbo: WebGLFramebuffer;

    private program: ShaderProgram;
    private outFbo: Fbo;

    constructor(ctx: OmniCanvasContextType, nodeId: string) {
      super(ctx, nodeId);
      this.frames = newTex3D(ctx.gl, 1, 1, 1);
      this.fbo = ctx.gl.createFramebuffer()!;
      this.outputs = [null];

      this.program = new ShaderProgram(
        ctx.gl,
        `
          #version 300 es
          in vec2 position;
          out vec2 vUV;
          void main() {
            vUV = 0.5 * (position + 1.0);
            gl_Position = vec4(position, 0.0, 1.0);
          }
        `,
        `
          #version 300 es
          precision mediump float;
          precision mediump sampler3D;
          uniform sampler3D uTex3D;
          uniform sampler2D uIndex;        // encodes desired frame offset in R
          uniform int       uHead;
          uniform int       uDepth;

          in vec2 vUV;
          out vec4 frag;

          int wrap(int x,int m){ return (x % m + m) % m; }

          void main(){
            // index texture gives offset [0,1] → [0,DEPTH)
            float offsetF = texture(uIndex, vUV).r * float(uDepth);
            int   offset  = int(offsetF + 0.5);            // round to nearest slice
            int   layer   = wrap(uHead - offset, uDepth);
            float w       = (float(layer) + 0.5) / float(uDepth);  // texel centre
            frag = texture(uTex3D, vec3(vUV, w));
          }
        `,
      );

      this.outFbo = newFbo(ctx.gl);
    }

    run({ inputs, paramValues }: RunProps) {
      const { gl, draw } = this.ctx;
      const tex = inputs[0];
      if (!tex) {
        this.outputs = [null];
        return;
      }

      const idxTex = inputs[1];
      if (!idxTex) {
        this.outputs = [null];
        return;
      }

      const width = tex.width;
      const height = tex.height;
      const depth = this.getParamValue(paramValues, "numFrames") as number;

      if (
        this.frames.width !== width ||
        this.frames.height !== height ||
        this.frames.depth !== depth
      ) {
        if (this.frames) {
          destroyTex3D(gl, this.frames);
        }
        this.frames = newTex3D(gl, width, height, depth);
        this.head = 0;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTextureLayer(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        this.frames.texture,
        0,
        this.head,
      );

      draw({
        texture: tex.texture,
        targetFramebuffer: this.fbo,
        viewport: [0, 0, width, height],
      });

      this.head = (this.head + 1) % this.frames.depth;

      ensureFboSize(this.outFbo, width, height);

      this.program.run({
        viewport: [0, 0, width, height],
        uniforms: {
          uTex3D: ["sampler3D", this.frames.texture],
          uIndex: ["sampler2D", idxTex.texture],
          uHead: ["1i", this.head],
          uDepth: ["1i", this.frames.depth],
        },
        fullscreen: true,
        targetFramebuffer: this.outFbo.framebuffer,
      });

      this.outputs = [this.outFbo.tex];
    }

    destroy() {
      destroyTex3D(this.ctx.gl, this.frames);
      deleteFbo(this.outFbo);
      this.ctx.gl.deleteFramebuffer(this.fbo);
    }
  },
);

function fragOp(numInputs: number, fragBody: string, params: OpParam[] = []) {
  assert(params.every((p) => p.type === "number"));

  const hasTime = fragBody.includes("time");

  const fragSrc =
    `precision mediump float;\n` +
    (hasTime ? `uniform float time;\n` : "") +
    params.map((p) => `uniform float ${p.varName};`).join("\n") +
    _.range(numInputs)
      .map((i) => `uniform sampler2D tex${i + 1};`)
      .join("\n") +
    `\nvarying vec2 uv;\n// lygia-includes\nvoid main(){\n${fragBody}\n}
  `;

  const vertSrc = `
    attribute vec2 position; varying vec2 uv;
    void main(){ uv = 0.5*(position+1.0); gl_Position = vec4(position,0.0,1.0); }
  `;

  return class extends BaseOp {
    numInputs = numInputs;
    numOutputs = 1;
    params = params;

    private program: ShaderProgram;
    private outFbo: Fbo;

    constructor(ctx: OmniCanvasContextType, nodeId: string) {
      super(ctx, nodeId);
      this.program = new ShaderProgram(ctx.gl, vertSrc, fragSrc);
      this.outFbo = newFbo(ctx.gl);
    }

    run({ inputs, paramValues }: RunProps) {
      inputs = inputs.map((tex) => tex ?? this.ctx.emptyTex);
      // if (inputs.some((i) => !i)) {
      //   this.outputs = [null];
      //   return;
      // }

      const { width, height } =
        inputs.length > 0 ? inputs[0]! : { width: 1280, height: 720 };

      ensureFboSize(this.outFbo, width, height);

      this.program.run({
        viewport: [0, 0, width, height],
        uniforms: {
          ...Object.fromEntries(
            params.map((p) => [
              p.varName,
              ["1f", Number(this.getParamValue(paramValues, p.varName) ?? 0)],
            ]),
          ),
          ...Object.fromEntries(
            inputs.map((value, i) => [
              `tex${i + 1}`,
              ["sampler2D", value!.texture],
            ]),
          ),
          ...(hasTime ? { time: ["1f", performance.now() / 1000] } : {}),
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
      vec2 uvFlip = uv + vec2(sin(uv.y / size) * strength, cos(uv.x / size) * strength);
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
        displayName: "Size",
        varName: "size",
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

    renderTop(props: TopProps) {
      return <OpKal {...props} instance={this} />;
    }
  },
);

const OpKal = (props: TopProps) => {
  const { data, instance, paramValuesUP } = props;

  return (
    <div className="text-xs">
      Wiggle <SentenceHandle idx={0} /> with strength{" "}
      <SentenceParam
        varName="strength"
        instance={instance}
        paramValues={data.paramValues}
        paramValuesUP={paramValuesUP}
      />{" "}
      and size{" "}
      <SentenceParam
        varName="size"
        instance={instance}
        paramValues={data.paramValues}
        paramValuesUP={paramValuesUP}
      />
    </div>
  );
};

const SentenceHandle = ({ idx }: { idx: number }) => {
  const handleClasses = clsx`
    nodrag
    w-3 h-3
    [&.clickconnecting]:bg-red-600
    border-none

    !static transform-none
  `;

  return (
    <Handle
      type="target"
      position={Position.Top}
      id={idxToInputHandle(idx)}
      className={clsx(handleClasses, "inline-block !transform-none rounded-sm")}
    />
  );
};

const SentenceParam = ({
  varName,
  instance,
  paramValues,
  paramValuesUP,
}: {
  varName: string;
  instance: BaseOp;
  paramValues: Record<string, unknown>;
  paramValuesUP: UpdateProxy<Record<string, unknown>>;
}) => {
  const param = instance.params?.find((p) => p.varName === varName);
  if (!param) {
    throw new Error(`Parameter ${varName} not found`);
  }
  if (param.type === "number") {
    const tooltip = (
      <div className="flex flex-row items-center gap-2">
        <div className="text-xs">{param.min}</div>
        <Slider
          className="w-32"
          value={[instance.getParamValue(paramValues, varName)]}
          min={param.min}
          max={param.max}
          step={param.step}
          onValueChange={(value) => {
            if (instance.params) {
              const param = instance.params.find((p) => p.varName === varName);
              if (param) {
                paramValuesUP[varName].$set(parseFloat(value.toString()));
              }
            }
          }}
        />
        <div className="text-xs">{param.max}</div>
      </div>
    );
    return (
      <Tooltip content={tooltip} delayDuration={0}>
        <span className="underline decoration-dotted">
          {instance.getParamValue(paramValues, varName)}
        </span>
      </Tooltip>
    );
  }

  throw new Error(`Unsupported parameter type: ${param.type}`);
};

const opDisplace = defineOp(
  class extends fragOp(
    3,
    `
      float x = texture2D(tex2, uv).r;
      float y = texture2D(tex3, uv).r;
      gl_FragColor = texture2D(tex1, uv + vec2(x, y) / 3.0);
    `,
    [],
  ) {
    static id = "displace" as const;
    static description = "Displace input based on X / Y inputs";
  },
);

const opBlack = defineOp(
  class extends fragOp(
    0,
    `
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    `,
  ) {
    static id = "black" as const;
    static description = "Black image";
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

    renderTop(props: TopProps) {
      return <OpMinus {...props} instance={this} />;
    }
  },
);

const OpMinus = (props: TopProps) => {
  const { data, instance, paramValuesUP } = props;

  return (
    <div className="text-xs">
      <SentenceHandle idx={0} /> - <SentenceHandle idx={1} />
    </div>
  );
};

const opBlend = defineOp(
  class extends fragOp(
    2,
    `
      vec3 tex1Color = vec3(texture2D(tex1, uv));
      vec3 tex2Color = vec3(texture2D(tex2, uv));
      gl_FragColor = vec4(mix(tex1Color, tex2Color, 0.5), 1.0);
    `,
  ) {
    static id = "blend" as const;
    static description = "Blend two images";

    renderTop(props: TopProps) {
      return <OpBlend {...props} instance={this} />;
    }
  },
);

const OpBlend = (props: TopProps) => {
  const { data, instance, paramValuesUP } = props;

  return (
    <div className="text-xs">
      Blend <SentenceHandle idx={0} /> with <SentenceHandle idx={1} />
    </div>
  );
};

const opTimes = defineOp(
  class extends fragOp(
    2,
    `
      vec3 tex1Color = vec3(texture2D(tex1, uv));
      vec3 tex2Color = vec3(texture2D(tex2, uv));
      gl_FragColor = vec4(tex1Color * tex2Color * alpha, 1.0);
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

const opLFO = defineOp(
  class extends fragOp(
    0,
    `
      float t = mod(time, period) / period;
      float value = (sin(t * 2.0 * 3.14159 + phase) + 1.0) * amplitude / 2.0;
      gl_FragColor = vec4(value, value, value, 1.0);
    `,
    [
      {
        displayName: "Amplitude",
        varName: "amplitude",
        type: "number",
        defaultValue: 1,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        displayName: "Period",
        varName: "period",
        type: "number",
        defaultValue: 1,
        min: 0.01,
        max: 10,
        step: 0.01,
      },
      {
        displayName: "Phase",
        varName: "phase",
        type: "number",
        defaultValue: 0,
        min: -Math.PI,
        max: Math.PI,
        step: 0.01,
      },
    ],
  ) {
    static id = "lfo" as const;
    static description = "Low-frequency oscillator";
  },
);

const opGradient = defineOp(
  class extends fragOp(
    0,
    `
      float angleRad = radians(angle);
      vec2 uvNorm = uv - 0.5;
      float x = cos(angleRad) * uvNorm.x - sin(angleRad) * uvNorm.y;
      gl_FragColor = vec4(vec3(x + 0.5), 1.0);
    `,
    [
      {
        displayName: "Angle",
        varName: "angle",
        type: "number",
        min: 0,
        max: 360,
        step: 1,
        defaultValue: 0,
      },
    ],
  ) {
    static id = "gradient" as const;
    static description = "Generate a gradient";
  },
);

const opSteps = defineOp(
  class extends fragOp(
    1,
    `
      vec3 tex1Color = vec3(texture2D(tex1, uv));
      float stepSize = 1.0 / float(steps);
      tex1Color = floor(tex1Color / stepSize) * stepSize;
      gl_FragColor = vec4(tex1Color, 1.0);
    `,
    [
      {
        displayName: "Steps",
        varName: "steps",
        type: "number",
        defaultValue: 0,
        min: 1,
        max: 20,
        step: 1,
      },
    ],
  ) {
    static id = "steps" as const;
    static description = "Reduce each channel to N steps";
  },
);

const opSNoise = defineOp(
  class extends fragOp(
    0,
    `
      #include <lygia/generative/snoise.glsl>

      float noise = snoise(vec3(uv.x / size, uv.y / size, version)) * 0.5 + 0.5;
      gl_FragColor = vec4(vec3(noise * strength), 1.0);
    `,
    [
      {
        displayName: "Strength",
        varName: "strength",
        type: "number",
        defaultValue: 1,
        min: 0,
        max: 2,
        step: 0.01,
      },
      {
        displayName: "Size",
        varName: "size",
        type: "number",
        defaultValue: 0.1,
        min: 0.01,
        max: 1,
        step: 0.01,
      },
      {
        displayName: "Version",
        varName: "version",
        type: "number",
        defaultValue: 0,
        min: 0,
        max: 10,
        step: 0.01,
      },
    ],
  ) {
    static id = "snoise" as const;
    static description = "Generate 2D simplex noise";
  },
);

export const opsInGroups = [
  ["Sources", [opWebcam]],
  ["Generators", [opLFO, opGradient, opBlack, opSNoise]],
  ["Space", [opHFlip, opVFlip, opKal, opDisplace]],
  ["Color", [opSteps]],
  ["Combiners", [opMinus, opBlend, opTimes]],
  ["Time", [opDelay, opTimeMachine]],
  ["Power", [opFrag]],
] as const;

export type AnyOpId = (typeof opsInGroups)[number][1][number]["id"];

const ops = opsInGroups.flatMap(
  (group) => group[1] as unknown as OpClass<AnyOpId>[],
);

export function opById(id: string): OpClass<AnyOpId> {
  const found = ops.find((op) => op.id === id);
  if (!found) {
    throw new Error(`Operation with id ${id} not found`);
  }
  return found;
}

export type OpNodeData = { opId: AnyOpId; paramValues: Record<string, any> };

export type OpNode = Node<OpNodeData, "operation">;

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
  runtimes: Record<string, BaseOp>,
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

    const inputs = _.range(runtime.numInputs).map((i) => {
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
