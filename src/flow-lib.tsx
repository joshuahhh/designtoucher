import { Edge, Node } from "@xyflow/react";
import _ from "lodash";
import { assert } from "./assert.js";
import { CodeMirrorControlled } from "./CodeMirrorControlled.js";
import { codeMirrorSetup } from "./codeMirrorSetup.js";
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
import { OmniCanvasContextType } from "./OmniCanvas.js";
import {
  medianNetworkFromSortingNetwork,
  parberryPairwiseNetwork,
} from "./sorting-networks.js";
import { toposortFromEdges } from "./toposort.js";
import { popFront, pushBack, pushFront } from "./util.js";

const opVideo = defineOp(
  class extends OpInstance {
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
  class extends OpInstance {
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
  class extends OpInstance {
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
  class extends OpInstance {
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
  class extends OpInstance {
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
  class extends OpInstance {
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
  class extends OpInstance {
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

  return class extends OpInstance {
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

// we have a great new convention for handles!
// the handleId is nodeId:input:key or nodeId:output:key
// where key is any old thing the node wants to use
// (no using :s in the key, natch)

export function makeInputHandleId(nodeId: string, key: string): string {
  return `${nodeId}:input:${key}`;
}
export function makeOutputHandleId(nodeId: string, key: string): string {
  return `${nodeId}:output:${key}`;
}
export function parseInputHandleId(handleId: string): {
  nodeId: string;
  key: string;
} {
  const match = handleId.match(/^(.+):input:(.+)$/);
  if (!match) throw new Error(`Invalid input handleId: ${handleId}`);
  return { nodeId: match[1], key: match[2] };
}
export function parseOutputHandleId(handleId: string): {
  nodeId: string;
  key: string;
} {
  const match = handleId.match(/^(.+):output:(.+)$/);
  if (!match) throw new Error(`Invalid output handleId: ${handleId}`);
  return { nodeId: match[1], key: match[2] };
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

  let lateHandles = new Set<string>();
  for (const runtime of Object.values(runtimes)) {
    for (const inputKey of runtime.getLateInputs()) {
      lateHandles.add(makeInputHandleId(runtime.nodeId, inputKey));
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
        const { nodeId, key: inputKey } = parseInputHandleId(
          edge.targetHandle!,
        );
        const sourceRuntime = runtimes[nodeId];
        if (!sourceRuntime) {
          console.warn(
            `Source runtime ${edge.source} not found for edge`,
            edge,
          );
          return [inputKey, null];
        }
        const outputKey = parseOutputHandleId(edge.sourceHandle!).key;
        return [inputKey, sourceRuntime.outputs[outputKey]];
      }),
    );
  }

  // run operations in sorted order
  sorted.sorted.forEach((nodeId) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node with id ${nodeId} not found`);

    const runtime = runtimes[nodeId];

    try {
      runtime.run({
        inputs: assembleInputs(nodeId, true),
        paramValues: node.data.paramValues,
      });
    } catch (error) {
      console.error(`Error running node ${nodeId}:`, error);
    }
  });

  // run all the runLate operations
  for (const runtime of Object.values(runtimes)) {
    try {
      const node = nodes.find((n) => n.id === runtime.nodeId);
      if (!node) throw new Error(`Node with id ${runtime.nodeId} not found`);

      runtime.runLate?.({
        inputs: assembleInputs(runtime.nodeId, false),
        paramValues: node.data.paramValues,
      });
    } catch (error) {
      console.error(`Error running late for node ${runtime.nodeId}:`, error);
    }
  }
}
