import { UpdateProxy } from "@engraft/update-proxy";
import { Popover, Slider } from "@radix-ui/themes";
import {
  Edge,
  Handle,
  Node,
  Position,
  useEdges,
  useNodeId,
} from "@xyflow/react";
import clsx from "clsx";
import _ from "lodash";
import { Peer } from "peerjs";
import { QRCodeSVG } from "qrcode.react";
import { Popover as PopoverPrimitive } from "radix-ui";
import {
  createContext,
  createRef,
  forwardRef,
  ReactNode,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { LuCopy, LuQrCode } from "react-icons/lu";
import { mergeRefs } from "react-merge-refs";
import { assert } from "./assert.js";
import { CodeMirrorControlled } from "./CodeMirrorControlled.js";
import { codeMirrorSetup } from "./codeMirrorSetup.js";
import { CopyButton } from "./CopyButton.js";
import { getHandleClasses } from "./Handles.js";
import {
  deleteFbo,
  destroyTex,
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
import { Monitor, OmniCanvasContextType } from "./OmniCanvas.js";
import {
  medianNetworkFromSortingNetwork,
  parberryPairwiseNetwork,
} from "./sorting-networks.js";
import { toposortFromEdges } from "./toposort.js";
import { popFront, pushBack, pushFront } from "./util.js";
import {
  enumerateCameras,
  startStream,
  stopStream,
  WebcamStream,
} from "./webcam.js";

type RunProps = {
  inputs: (Tex | null)[];
  paramValues: Record<string, unknown>;
};

type TopProps = {
  paramValues: Record<string, unknown>;
  paramValuesUP: UpdateProxy<Record<string, unknown>>;
  instance: BaseOp;
  phony: boolean;
};

export type OpClass<Id extends string> = {
  id: Id;
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
  runLate?(props: RunProps): void;
  getLateInputs(): number[] {
    return [];
  }
  abstract destroy(): void;
  abstract numInputs: number;
  abstract numOutputs: number;
  params?: OpParam[] | undefined;

  getClass(): OpClass<string> {
    return this.constructor as OpClass<string>;
  }

  // TODO: provisional stop-gap
  renderTop(props: TopProps): ReactNode {
    return (
      <Sentence>
        <div className="flex gap-2">
          ⌛<pre>{this.getClass().id}</pre>
          {_.range(this.numInputs).map((i) => (
            <SentenceHandle key={i} idx={i} phony={props.phony} />
          ))}
        </div>
        {this.params?.map((param, i) => (
          <div key={i} className="flex gap-2">
            <label htmlFor={param.varName}>{param.displayName}</label>
            <SentenceParam
              varName={param.varName}
              instance={this}
              paramValues={props.paramValues}
              paramValuesUP={props.paramValuesUP}
            />
          </div>
        ))}
      </Sentence>
    );
  }

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

const opFeedbackBuffer = defineOp(
  class extends BaseOp {
    static id = "feedback-buffer" as const;

    numInputs = 1;
    numOutputs = 1;
    params: OpParam[] = [];

    fbo: Fbo;

    constructor(ctx: OmniCanvasContextType, nodeId: string) {
      super(ctx, nodeId);

      this.fbo = newFbo(ctx.gl);
      this.outputs = [this.fbo.tex];
    }

    run() {}
    destroy() {
      deleteFbo(this.fbo);
    }

    runLate({ inputs }: RunProps) {
      const tex = inputs[0];
      if (!tex) {
        return;
      }

      ensureFboSize(this.fbo, tex.width, tex.height);
      this.ctx.draw({
        texture: tex.texture,
        targetFramebuffer: this.fbo.framebuffer,
        viewport: [0, 0, tex.width, tex.height],
      });
    }
    getLateInputs(): number[] {
      return [0];
    }

    renderTop(props: TopProps): ReactNode {
      return <OpFeedbackBuffer {...props} instance={this} />;
    }
  },
);

const OpFeedbackBuffer = ({ instance, phony }: TopProps) => {
  return (
    <Sentence>
      Feedback buffer
      <SentenceHandle idx={0} phony={phony} />
    </Sentence>
  );
};

function assuredlyVideo(
  video: HTMLVideoElement | HTMLImageElement,
): HTMLVideoElement {
  return video as HTMLVideoElement;
}

const opWebcam = defineOp(
  class extends BaseOp {
    static id = "cam" as const;

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

    cams: MediaDeviceInfo[] | null = null;
    defaultDeviceId: string | null = null;

    constructor(ctx: OmniCanvasContextType, nodeId: string) {
      super(ctx, nodeId);

      (async () => {
        this.cams = await enumerateCameras();
      })();

      this.outputs = [null];
    }

    run({ paramValues }: RunProps) {
      const { gl } = this.ctx;

      if (!this.cams) {
        return;
      }

      const deviceId = paramValues["deviceId"] ?? this.defaultDeviceId;

      // TODO: this is extremely chaotic code; I don't like it
      // concretely: I think switching cameras causes a cascade of open operations
      // and the lack of access to paramValues sucks
      // but... it just barely works

      if (!this.webcamStream || this.webcamStream.deviceId !== deviceId) {
        if (deviceId) {
          // try to find the camera by deviceId
          const cam = this.cams.find((d) => d.deviceId === deviceId);
          if (cam) {
            (async () => {
              this.webcamStream = await startStream(cam.deviceId, 1920);
            })();
            return;
          }
        }

        // find facetime cam
        let camToUse = this.cams.find((d) => d.label.includes("FaceTime"));
        // const facetimeCam = cams.find((d) => d.label.includes("OBS"));
        if (!camToUse) {
          console.warn("No FaceTime camera found, using first video input");
          if (this.cams.length === 0) {
            throw new Error("No video input devices found");
          }
          camToUse = this.cams[0];
        }

        this.defaultDeviceId = camToUse.deviceId;
        (async () => {
          this.webcamStream = await startStream(camToUse.deviceId, 1920);
        })();
        return;

        // console.log(
        //   "Webcam stream started",
        //   this.webcamStream.width,
        //   this.webcamStream.height,
        // );
      }

      const video = assuredlyVideo(this.webcamStream.video);

      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        console.warn("webcam lost readiness", this.nodeId, video.readyState);
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
        video,
      );
      // console.log("AFTER texSubImage2D");
      this.tex.width = this.webcamStream.width;
      this.tex.height = this.webcamStream.height;

      if (!this.webcamStream.facingMode.includes("environment")) {
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

    renderTop(props: TopProps) {
      return <OpWebcam {...props} instance={this} />;
    }
  },
);

const OpWebcam = ({ instance, paramValues, paramValuesUP }: TopProps) => {
  const cams = (instance as any).cams as MediaDeviceInfo[] | null;
  return (
    <Sentence>
      Use input{" "}
      {/* <span className="underline decoration-dotted">FaceTime camera</span> */}
      {cams ? (
        <SentenceParamSelect
          varName="deviceId"
          paramValues={paramValues}
          paramValuesUP={paramValuesUP}
          options={cams.map((cam) => ({
            label: cam.label,
            value: cam.deviceId,
          }))}
          defaultValue=""
        />
      ) : (
        "..."
      )}
    </Sentence>
  );
};

const opRemoteCam = defineOp(
  class extends BaseOp {
    static id = "remote-cam" as const;

    numInputs = 0;
    numOutputs = 1;

    webcamStream: WebcamStream | null = null;
    video: HTMLVideoElement = document.createElement("video");
    id: string | null = null;
    tex: Tex | null = null;

    constructor(ctx: OmniCanvasContextType, nodeId: string) {
      super(ctx, nodeId);

      const peer = new Peer();

      peer.on("open", (id) => {
        this.id = id;
      });

      // Answer incoming media calls; we don't send any tracks
      peer.on("call", (call) => {
        console.log("got a call!", call);
        call.answer(); // receive-only
        call.on("stream", (stream) => {
          console.log("got a stream!", stream);
          this.video.srcObject = stream;
          this.video.play();
        });
        call.on("error", (e) => console.error("Call error:", e));
        call.on("close", () => console.log("Call closed"));
      });

      peer.on("error", (e) => console.error("Peer error:", e));

      this.outputs = [this.tex];
    }

    run({ paramValues }: RunProps) {
      const { gl } = this.ctx;

      const video = assuredlyVideo(this.video);

      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }
      console.log("video", video.readyState);

      if (!this.tex) {
        console.log(
          "Creating new texture for remote cam",
          video.videoWidth,
          video.videoHeight,
        );
        this.tex = newTex(
          this.ctx.gl,
          this.video.videoWidth,
          this.video.videoHeight,
        );
        this.outputs = [this.tex];
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
        video,
      );
    }

    destroy() {
      if (this.webcamStream) {
        stopStream(this.webcamStream);
        this.webcamStream = null;
      }
    }

    renderTop(props: TopProps) {
      return <OpRemoteCam {...props} instance={this} />;
    }
  },
);

const OpRemoteCam = ({ instance, paramValues, paramValuesUP }: TopProps) => {
  const id = (instance as any).id;
  const senderUrl = window.location.href + "#sender/" + id;

  if (id === null) {
    return (
      <Sentence>
        Use remote camera <span className="italic">[loading...]</span>
      </Sentence>
    );
  }

  const buttonClassName = clsx(
    "border border-gray-300 rounded-md p-1 shadow-sm hover:bg-gray-50 transition-colors",
  );

  return (
    <Sentence>
      <div>Use remote camera @ {id.slice(0, 8)}</div>
      <div className="flex gap-2">
        <CopyButton text={senderUrl} className={buttonClassName}>
          <LuCopy className="inline-block" />
          Copy URL
        </CopyButton>
        <Popover.Root>
          <Popover.Trigger>
            <button
              className={clsx(
                "inline-flex items-center gap-1",
                buttonClassName,
              )}
            >
              <LuQrCode className="inline-block" />
              Show URL QR
            </button>
          </Popover.Trigger>
          <Popover.Content side="top" size="1">
            <PopoverPrimitive.Arrow />
            <QRCodeSVG value={senderUrl} />
          </Popover.Content>
        </Popover.Root>
      </div>
    </Sentence>
  );
};

const opVideo = defineOp(
  class extends BaseOp {
    static id = "video" as const;

    numInputs = 0;
    numOutputs = 1;
    params: OpParam[] = [];
    video: HTMLVideoElement | null = null;
    tex: Tex | null = null;

    run({ paramValues }: RunProps) {
      const { gl } = this.ctx;

      if (!this.video) {
        return;
      }

      if (!this.tex) {
        console.log(
          "Creating new texture for video",
          this.video.videoWidth,
          this.video.videoHeight,
        );
        this.tex = newTex(
          this.ctx.gl,
          this.video.videoWidth,
          this.video.videoHeight,
        );
      }

      gl.bindTexture(gl.TEXTURE_2D, this.tex.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.video,
      );
      this.tex.width = this.video.videoWidth;
      this.tex.height = this.video.videoHeight;

      this.outputs = [this.tex];
    }

    destroy() {
      if (this.video) {
        this.video.pause();
        this.video.srcObject = null;
        this.video = null;
      }
      if (this.tex) {
        destroyTex(this.ctx.gl, this.tex);
        this.tex = null;
      }
    }

    renderTop(props: TopProps) {
      return <OpVideo {...props} instance={this} />;
    }
  },
);

const OpVideo = ({ instance }: TopProps) => {
  return (
    <Sentence>
      Video file{" "}
      <span className="underline decoration-dotted">
        <input
          type="file"
          accept="video/*"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              const file = e.target.files[0];
              const video = document.createElement("video");
              video.src = URL.createObjectURL(file);
              video.crossOrigin = "anonymous";
              video.loop = true;
              video.muted = true;
              video.play();
              (instance as any).video = video;
            }
          }}
          className="text-[80%] w-36"
        />
      </span>
    </Sentence>
  );
};

const opDelay = defineOp(
  class extends BaseOp {
    static id = "delay" as const;

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
  const { paramValues, instance, paramValuesUP, phony } = props;

  return (
    <Sentence>
      Delay <SentenceHandle idx={0} phony={phony} /> by{" "}
      <SentenceParam
        varName="framesOfDelay"
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
      />{" "}
      frames
    </Sentence>
  );
};

const opFrag = defineOp(
  class extends BaseOp {
    static id = "frag" as const;

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

    renderTop(props: TopProps) {
      return <OpFrag {...props} instance={this} />;
    }
  },
);

const OpFrag = ({ phony, paramValues, paramValuesUP, instance }: TopProps) => {
  return (
    <>
      <Sentence>
        Feed <SentenceHandle idx={0} phony={phony} /> into fragment shader
      </Sentence>
      <CodeMirrorControlled
        className="nodrag text-xs"
        value={instance.getParamValue(paramValues, "fragBody") as string}
        extensions={codeMirrorSetup}
        setValue={paramValuesUP["fragBody"].$set}
      />
    </>
  );
};

const opTimeMachine = defineOp(
  class extends BaseOp {
    static id = "timeMachine" as const;

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

const opSwitch = defineOp(
  class extends BaseOp {
    static id = "switch" as const;

    numInputs = 3; // doesn't matter
    numOutputs = 1;
    params: OpParam[] = [
      {
        displayName: "Input index",
        varName: "inputIndex",
        type: "number",
        defaultValue: 0,
        min: 0,
        max: 2,
        step: 1,
      },
    ];
    run({ inputs, paramValues }: RunProps) {
      const index = this.getParamValue(paramValues, "inputIndex") as number;
      if (index < 0 || index >= inputs.length) {
        throw new Error(`Input index out of bounds: ${index}`);
      }
      this.outputs = [inputs[index]];
    }
    destroy() {
      // nothing to destroy
    }
    renderTop(props: TopProps) {
      return (
        <Sentence>
          Switch to input <SentenceHandle idx={0} phony={props.phony} />{" "}
          <SentenceHandle idx={1} phony={props.phony} />{" "}
          <SentenceHandle idx={2} phony={props.phony} />{" "}
          <SentenceParam
            varName="inputIndex"
            instance={this}
            paramValues={props.paramValues}
            paramValuesUP={props.paramValuesUP}
          />
        </Sentence>
      );
    }
  },
);

const opMedian = defineOp(
  class extends BaseOp {
    static id = "median" as const;

    numInputs = 1;
    numOutputs = 1;
    params: OpParam[] = [
      {
        displayName: "Number of frames",
        varName: "numFrames",
        type: "number",
        min: 1,
        max: 91,
        step: 2,
        defaultValue: 15,
      },
    ];

    private frames: Tex3D;
    private head: number = 0;
    private fbo: WebGLFramebuffer;

    private program: ShaderProgram | null = null;
    private programDepth: number = 0;
    private outFbo: Fbo;

    constructor(ctx: OmniCanvasContextType, nodeId: string) {
      super(ctx, nodeId);
      this.frames = newTex3D(ctx.gl, 1, 1, 1);
      this.fbo = ctx.gl.createFramebuffer()!;
      this.outputs = [null];
      this.outFbo = newFbo(ctx.gl);
    }

    run({ inputs, paramValues }: RunProps) {
      const { gl, draw } = this.ctx;
      const tex = inputs[0];
      if (!tex) {
        this.outputs = [null];
        return;
      }

      const width = tex.width;
      const height = tex.height;
      const depth = this.getParamValue(paramValues, "numFrames") as number;

      if (!this.program || depth !== this.programDepth) {
        this.programDepth = depth;

        const network = medianNetworkFromSortingNetwork(
          parberryPairwiseNetwork(depth),
        );
        const medianIndex = Math.floor(depth / 2);

        const fsSource = `
          #version 300 es
          precision mediump float;
          precision mediump sampler3D;
          uniform sampler3D uTex3D;
          uniform int       uDepth;

          in vec2 vUV;
          out vec4 frag;

          const int MAX_Z = 128; // set to your max texture depth

          void main() {
            float ${_.range(depth)
              .map((i) => `r${i}`)
              .join(", ")};
            float ${_.range(depth)
              .map((i) => `g${i}`)
              .join(", ")};
            float ${_.range(depth)
              .map((i) => `b${i}`)
              .join(", ")};

            // collect per-slice samples
            ${_.range(depth)
              .map(
                (z) => `
              {
                float w = (float(${z}) + 0.5) / float(uDepth);
                vec4 v = texture(uTex3D, vec3(vUV, w));
                r${z} = v.r; g${z} = v.g; b${z} = v.b;
              }
            `,
              )
              .join("\n")}

            // apply median network to each channel
            ${["r", "g", "b"]
              .map((channel) =>
                network.comps
                  .map(
                    ([a, b]) => `
                      {
                        float mn = min(${channel}${a}, ${channel}${b});
                        float mx = max(${channel}${a}, ${channel}${b});
                        ${channel}${a} = mn;
                        ${channel}${b} = mx;
                      }
                    `,
                  )
                  .join("\n"),
              )
              .join("\n")}

            // output the median value
            frag = vec4(r${medianIndex}, g${medianIndex}, b${medianIndex}, 1.0);
            // frag = r0 == r30 ? vec4(0.0, 1.0, 0.0, 1.0) : vec4(1.0, 0.0, 0.0, 1.0);
          }
        `;

        this.program = new ShaderProgram(
          this.ctx.gl,
          `
            #version 300 es
            in vec2 position;
            out vec2 vUV;
            void main() {
              vUV = 0.5 * (position + 1.0);
              gl_Position = vec4(position, 0.0, 1.0);
            }
          `,
          fsSource,
        );
        if (false) {
          this.program = new ShaderProgram(
            this.ctx.gl,
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
            uniform int       uDepth;

            in vec2 vUV;
            out vec4 frag;

            const int MAX_Z = 128; // set to your max texture depth

            // partially select so a[k] is the k-th smallest; also makes a[0..k] sorted
            float medianOfN(inout float a[MAX_Z], int N) {
              int k = N / 2;
              for (int i = 0; i <= k; ++i) {
                int m = i;
                for (int j = i + 1; j < N; ++j)
                  if (a[j] < a[m]) m = j;
                float t = a[i]; a[i] = a[m]; a[m] = t;
              }
              return (N & 1) == 1 ? a[k] : 0.5 * (a[k - 1] + a[k]);
            }

            vec3 medianAlongW_RGB(sampler3D tex3D, vec2 uv) {
              ivec3 sz = textureSize(tex3D, 0);
              int N = min(sz.z, MAX_Z);

              float r[MAX_Z], g[MAX_Z], b[MAX_Z];

              // collect per-slice samples once
              for (int z = 0; z < N; ++z) {
                float w = (float(z) + 0.5) / float(sz.z);
                vec3 v = texture(tex3D, vec3(uv, w)).rgb;
                r[z] = v.r; g[z] = v.g; b[z] = v.b;
              }

              // per-channel medians
              float mr = medianOfN(r, N);
              float mg = medianOfN(g, N);
              float mb = medianOfN(b, N);

              return vec3(mr, mg, mb);
            }

            void main(){
              frag = vec4(medianAlongW_RGB(uTex3D, vUV), 1.0);
            }
          `,
          );
        }
      }

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

    renderTop(props: TopProps) {
      return <OpMedian {...props} instance={this} />;
    }
  },
);

const OpMedian = ({
  phony,
  paramValues,
  paramValuesUP,
  instance,
}: TopProps) => (
  <Sentence>
    Median of <SentenceHandle idx={0} phony={phony} /> with{" "}
    <SentenceParam
      varName="numFrames"
      instance={instance}
      paramValues={paramValues}
      paramValuesUP={paramValuesUP}
    />{" "}
    frames
  </Sentence>
);

const opMedianOld = defineOp(
  class extends BaseOp {
    static id = "median_old" as const;

    numInputs = 1;
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

    private program: ShaderProgram | null = null;
    private programDepth: number = 0;
    private outFbo: Fbo;

    constructor(ctx: OmniCanvasContextType, nodeId: string) {
      super(ctx, nodeId);
      this.frames = newTex3D(ctx.gl, 1, 1, 1);
      this.fbo = ctx.gl.createFramebuffer()!;
      this.outputs = [null];
      this.outFbo = newFbo(ctx.gl);
    }

    run({ inputs, paramValues }: RunProps) {
      const { gl, draw } = this.ctx;
      const tex = inputs[0];
      if (!tex) {
        this.outputs = [null];
        return;
      }

      const width = tex.width;
      const height = tex.height;
      const depth = 31; // this.getParamValue(paramValues, "numFrames") as number;

      if (!this.program || depth !== this.programDepth) {
        this.programDepth = depth;
        this.program = new ShaderProgram(
          this.ctx.gl,
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
            uniform int       uDepth;

            in vec2 vUV;
            out vec4 frag;

            const int MAX_Z = 128; // set to your max texture depth

            // partially select so a[k] is the k-th smallest; also makes a[0..k] sorted
            float medianOfN(inout float a[MAX_Z], int N) {
              int k = N / 2;
              for (int i = 0; i <= k; ++i) {
                int m = i;
                for (int j = i + 1; j < N; ++j)
                  if (a[j] < a[m]) m = j;
                float t = a[i]; a[i] = a[m]; a[m] = t;
              }
              return (N & 1) == 1 ? a[k] : 0.5 * (a[k - 1] + a[k]);
            }

            vec3 medianAlongW_RGB(sampler3D tex3D, vec2 uv) {
              ivec3 sz = textureSize(tex3D, 0);
              int N = min(sz.z, MAX_Z);

              float r[MAX_Z], g[MAX_Z], b[MAX_Z];

              // collect per-slice samples once
              for (int z = 0; z < N; ++z) {
                float w = (float(z) + 0.5) / float(sz.z);
                vec3 v = texture(tex3D, vec3(uv, w)).rgb;
                r[z] = v.r; g[z] = v.g; b[z] = v.b;
              }

              // per-channel medians
              float mr = medianOfN(r, N);
              float mg = medianOfN(g, N);
              float mb = medianOfN(b, N);

              return vec3(mr, mg, mb);
            }

            void main(){
              frag = vec4(medianAlongW_RGB(uTex3D, vUV), 1.0);
            }
          `,
        );
      }

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

    renderTop(props: TopProps) {
      return <OpMedianOld {...props} instance={this} />;
    }
  },
);

const OpMedianOld = ({
  phony,
  paramValues,
  paramValuesUP,
  instance,
}: TopProps) => (
  <Sentence>
    OLD Feed <SentenceHandle idx={0} phony={phony} /> into median with{" "}
    <SentenceParam
      varName="numFrames"
      instance={instance}
      paramValues={paramValues}
      paramValuesUP={paramValuesUP}
    />{" "}
    frames
  </Sentence>
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

    renderTop(props: TopProps) {
      return <OpKal {...props} instance={this} />;
    }
  },
);

const OpKal = (props: TopProps) => {
  const { instance, paramValues, paramValuesUP, phony } = props;

  return (
    <Sentence>
      Wiggle <SentenceHandle idx={0} phony={phony} /> with strength{" "}
      <SentenceParam
        varName="strength"
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
      />{" "}
      and size{" "}
      <SentenceParam
        varName="size"
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
      />
    </Sentence>
  );
};

export const FlowContext = createContext<{
  runtimes: Record<string, BaseOp>;
}>(undefined!);

const SentenceHandle = ({ idx, phony }: { idx: number; phony: boolean }) => {
  // figure out if we're downstream of a node
  const edges = useEdges();
  const nodeId = useNodeId();
  const edge = edges.find(
    (edge) =>
      edge.target === nodeId && edge.targetHandle === idxToInputHandle(idx),
  );
  const flowContext = useContext(FlowContext);

  const sourceOutput =
    flowContext && edge
      ? flowContext.runtimes[edge.source].outputs[
          outputHandleToIdx(edge.sourceHandle)
        ]
      : null;

  const className = clsx(getHandleClasses(false), {
    "w-3 h-3": !sourceOutput,
    "h-4 align-text-bottom": sourceOutput,
  });

  return phony ? (
    <div className={className} />
  ) : (
    <Handle
      type="target"
      position={Position.Top}
      id={idxToInputHandle(idx)}
      className={className}
    >
      {sourceOutput ? (
        <Monitor tex={sourceOutput} className="pointer-events-none" />
      ) : null}
    </Handle>
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
    return (
      <SentenceParamNumber
        varName={varName}
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
        param={param}
      />
    );
  }

  throw new Error(`Unsupported parameter type: ${param.type}`);
};

const StableWidthSpan = forwardRef<
  HTMLSpanElement,
  {
    dragging?: boolean;
  } & React.HTMLAttributes<HTMLSpanElement>
>(({ dragging, ...otherProps }, forwardedRef) => {
  const ref = createRef<HTMLSpanElement>();
  const [minWidth, setMinWidth] = useState(0);

  useLayoutEffect(() => {
    if (dragging && ref.current) {
      const w = ref.current.offsetWidth;
      setMinWidth((prev) => Math.max(prev, w));
    }
    if (!dragging) {
      setMinWidth(0); // release lock
    }
  }, [dragging, ref]);

  return (
    <span
      ref={mergeRefs([ref, forwardedRef])}
      {...otherProps}
      style={{
        ...otherProps.style,
        // color: dragging ? "red" : "inherit",
        display: "inline-block",
        minWidth: dragging ? minWidth : "inherit",
      }}
    />
  );
});

const SentenceParamNumber = ({
  varName,
  instance,
  paramValues,
  paramValuesUP,
  param,
}: {
  varName: string;
  instance: BaseOp;
  paramValues: Record<string, unknown>;
  paramValuesUP: UpdateProxy<Record<string, unknown>>;
  param: OpParam & { type: "number" };
}) => {
  const [dragging, setDragging] = useState(false);

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
          setDragging(true);
        }}
        onValueCommit={() => {
          setDragging(false);
        }}
      />
      <div className="text-xs">{param.max}</div>
    </div>
  );
  return (
    <Popover.Root>
      <Popover.Trigger>
        <StableWidthSpan
          dragging={dragging}
          className="underline decoration-dotted tabular-nums"
        >
          {instance.getParamValue(paramValues, varName)}
        </StableWidthSpan>
      </Popover.Trigger>
      <Popover.Content side="top" size="1">
        <PopoverPrimitive.Arrow />
        {tooltip}
      </Popover.Content>
    </Popover.Root>
  );
};

// we're breaking off from "params" here. that stuff sucks
const SentenceParamSelect = ({
  varName,
  paramValues,
  paramValuesUP,
  options,
  defaultValue,
}: {
  varName: string;
  paramValues: Record<string, unknown>;
  paramValuesUP: UpdateProxy<Record<string, unknown>>;
  options: { value: string; label: string }[];
  defaultValue: string;
}) => {
  return (
    <select
      value={(paramValues[varName] as string) ?? defaultValue}
      className="text-xs font-['Varela_Round'] bg-transparent border-b border"
      onChange={(e) => {
        paramValuesUP[varName].$set(e.target.value);
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

const opDisplace = defineOp(
  class extends fragOp(
    3,
    `
      float x = texture2D(tex2, uv).r;
      float y = texture2D(tex3, uv).r;
      vec2 newUV = uv + vec2(x, y) / 3.0;
      if (newUV.x < 0.0 || newUV.x > 1.0 || newUV.y < 0.0 || newUV.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
      } else {
        gl_FragColor = texture2D(tex1, newUV);
      }
    `,
    [],
  ) {
    static id = "displace" as const;

    renderTop(props: TopProps) {
      return <OpDisplace {...props} instance={this} />;
    }
  },
);

const OpDisplace = (props: TopProps) => {
  const { instance, paramValues, paramValuesUP, phony } = props;

  return (
    <Sentence>
      Displace <SentenceHandle idx={0} phony={phony} /> by X:{" "}
      <SentenceHandle idx={1} phony={phony} /> Y:{" "}
      <SentenceHandle idx={2} phony={phony} />
    </Sentence>
  );
};

const opBlack = defineOp(
  class extends fragOp(
    0,
    `
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    `,
  ) {
    static id = "black" as const;
  },
);

const opMinus = defineOp(
  class extends fragOp(
    2,
    `
      vec3 tex1Color = vec3(texture2D(tex1, uv));
      vec3 tex2Color = vec3(texture2D(tex2, uv));
      gl_FragColor = vec4(abs(tex1Color - tex2Color), 1.0);
    `,
  ) {
    static id = "minus" as const;

    renderTop(props: TopProps) {
      return <OpMinus {...props} instance={this} />;
    }
  },
);

const OpMinus = ({ phony }: TopProps) => {
  return (
    <Sentence>
      Math: abs(
      <SentenceHandle idx={0} phony={phony} /> -{" "}
      <SentenceHandle idx={1} phony={phony} />)
    </Sentence>
  );
};

const opPlus = defineOp(
  class extends fragOp(
    2,
    `
      vec3 tex1Color = vec3(texture2D(tex1, uv));
      vec3 tex2Color = vec3(texture2D(tex2, uv));
      gl_FragColor = vec4(tex1Color + tex2Color + alpha, 1.0);
    `,
    [
      {
        displayName: "Alpha",
        varName: "alpha",
        type: "number",
        defaultValue: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
    ],
  ) {
    static id = "plus" as const;

    renderTop(props: TopProps) {
      return <OpPlus {...props} instance={this} />;
    }
  },
);

const OpPlus = ({ phony, instance, paramValues, paramValuesUP }: TopProps) => {
  return (
    <Sentence>
      Math: <SentenceHandle idx={0} phony={phony} /> +{" "}
      <SentenceHandle idx={1} phony={phony} /> ( +{" "}
      <SentenceParam
        varName="alpha"
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
      />
      )
    </Sentence>
  );
};

const Sentence = ({ children }: { children: ReactNode }) => {
  return <div className="text-xs font-['Varela_Round'] ">{children}</div>;
};

const opBlend = defineOp(
  class extends fragOp(
    2,
    `
      vec3 tex1Color = vec3(texture2D(tex1, uv));
      vec3 tex2Color = vec3(texture2D(tex2, uv));
      gl_FragColor = vec4(mix(tex1Color, tex2Color, ratio), 1.0);
    `,
    [
      {
        displayName: "Ratio",
        varName: "ratio",
        type: "number",
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.001,
      },
    ],
  ) {
    static id = "blend" as const;

    renderTop(props: TopProps) {
      return <OpBlend {...props} instance={this} />;
    }
  },
);

const OpBlend = ({ instance, phony, paramValues, paramValuesUP }: TopProps) => {
  return (
    <Sentence>
      Blend <SentenceHandle idx={0} phony={phony} /> with{" "}
      <SentenceHandle idx={1} phony={phony} /> at{" "}
      <SentenceParam
        varName="ratio"
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
      />{" "}
    </Sentence>
  );
};

const opLayer = defineOp(
  // lol I guess I should do this just by drawing the second texture
  // on top of the first? but it's easier to just use a frag shader.
  // remember, this is all about drawing with transparency. no
  // forgetting about any alpha channels.
  class extends fragOp(
    2,
    `
      vec4 A = texture2D(tex2, uv);
      vec4 B = texture2D(tex1, uv);
      float outA = B.a + A.a * (1.0 - B.a);
      vec3 outRGB = (B.rgb * B.a + A.rgb * A.a * (1.0 - B.a)) / max(outA, 1e-6);
      gl_FragColor = vec4(outRGB, outA);
    `,
  ) {
    static id = "layer" as const;

    renderTop(props: TopProps) {
      return <OpLayer {...props} instance={this} />;
    }
  },
);

const OpLayer = ({ instance, phony, paramValues, paramValuesUP }: TopProps) => {
  return (
    <Sentence>
      Layer <SentenceHandle idx={0} phony={phony} /> over{" "}
      <SentenceHandle idx={1} phony={phony} />
    </Sentence>
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

    renderTop(props: TopProps) {
      return <OpTimes {...props} instance={this} />;
    }
  },
);

const OpTimes = ({ phony, instance, paramValues, paramValuesUP }: TopProps) => {
  return (
    <Sentence>
      Math: <SentenceHandle idx={0} phony={phony} /> ✕{" "}
      <SentenceHandle idx={1} phony={phony} /> ( ✕{" "}
      <SentenceParam
        varName="alpha"
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
      />{" "}
      )
    </Sentence>
  );
};

const opLFO = defineOp(
  class extends fragOp(
    0,
    `
      float t = mod(time, period) / period;
      float value = (sin(t * 2.0 * 3.14159 + phase * 3.14159 / 180.0) + 1.0) * amplitude / 2.0;
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
        min: -180,
        max: 180,
        step: 0.01,
      },
    ],
  ) {
    static id = "lfo" as const;

    renderTop(props: TopProps) {
      return <OpLFO {...props} instance={this} />;
    }
  },
);

const OpLFO = (props: TopProps) => {
  const { instance, paramValues, paramValuesUP, phony } = props;

  return (
    <Sentence>
      Oscillate with amplitude{" "}
      <SentenceParam
        varName="amplitude"
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
      />{" "}
      , period{" "}
      <SentenceParam
        varName="period"
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
      />{" "}
      , phase{" "}
      <SentenceParam
        varName="phase"
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
      />
    </Sentence>
  );
};

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

    renderTop(props: TopProps) {
      return <OpSNoise {...props} />;
    }
  },
);

const OpSNoise = ({
  phony,
  instance,
  paramValues,
  paramValuesUP,
}: TopProps) => {
  return (
    <Sentence>
      Make <b>simplex noise</b> with strength{" "}
      <SentenceParam
        varName="strength"
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
      />{" "}
      , size{" "}
      <SentenceParam
        varName="size"
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
      />{" "}
      , and version{" "}
      <SentenceParam
        varName="version"
        instance={instance}
        paramValues={paramValues}
        paramValuesUP={paramValuesUP}
      />
    </Sentence>
  );
};

export const opsInGroups = [
  ["Sources", [opWebcam, opVideo, opRemoteCam]],
  ["Generators", [opLFO, opGradient, opBlack, opSNoise]],
  ["Space", [opHFlip, opVFlip, opKal, opDisplace]],
  ["Color", [opSteps]],
  ["Combiners", [opLayer, opSwitch, opMinus, opPlus, opBlend, opTimes]],
  ["Time", [opFeedbackBuffer, opDelay, opTimeMachine, opMedian, opMedianOld]],
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

  let lateHandles = new Set<string>();
  for (const runtime of Object.values(runtimes)) {
    for (const idx of runtime.getLateInputs()) {
      lateHandles.add(runtime.nodeId + "-" + idxToInputHandle(idx));
    }
  }

  const upToDateEdges = edges.filter(
    (edge) => !lateHandles.has(edge.target + "-" + edge.targetHandle),
  );

  // toposort nodes based on edges
  const sorted = toposortFromEdges(
    nodes.map((n) => n.id),
    upToDateEdges.map((e) => [e.target, e.source]),
  );
  if (sorted.cyclic.size > 0)
    throw new Error("Cyclic dependencies detected in the flow");

  // run operations in sorted order
  sorted.sorted.forEach((nodeId) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node with id ${nodeId} not found`);

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

  // run all the runLate operations
  for (const runtime of Object.values(runtimes)) {
    try {
      const node = nodes.find((n) => n.id === runtime.nodeId);
      if (!node) throw new Error(`Node with id ${runtime.nodeId} not found`);

      const inputs = _.range(runtime.numInputs).map((i) => {
        const edge = edges.find(
          (e) =>
            e.target === runtime.nodeId &&
            e.targetHandle === idxToInputHandle(i),
        );
        if (!edge) {
          return null;
        }
        return runtimes[edge.source].outputs[
          outputHandleToIdx(edge.sourceHandle)
        ];
      });
      runtime.runLate?.({ inputs, paramValues: node.data.paramValues });
    } catch (error) {
      console.error(`Error running late for node ${runtime.nodeId}:`, error);
    }
  }
}
