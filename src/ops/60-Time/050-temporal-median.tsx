import _ from "lodash";
import {
  destroyFbo,
  destroyTex3D,
  ensureFboSize,
  newFbo,
  newTex3D,
  ShaderProgram,
} from "../../mygl.js";
import { defineOp, Sentence, SentenceParamNumber } from "../../ops-core.js";
import {
  medianNetworkFromSortingNetwork,
  parberryPairwiseNetwork,
} from "../../sorting-networks.js";

export default defineOp({
  id: "temporal-median",
  inputKeys: ["tex1"],
  initParams: () => ({
    numFrames: 15,
  }),
  initRuntime(ctx) {
    const outFbo = newFbo(ctx.gl);

    return {
      frames: newTex3D(ctx.gl, 1, 1, 1),
      head: 0,
      framebuffer: ctx.gl.createFramebuffer(),

      program: null as ShaderProgram | null,
      programDepth: 0,

      outFbo: outFbo,
      out: outFbo.tex,
    };
  },
  run({ inputs, params, runtime, ctx }) {
    const { gl, draw } = ctx;
    const tex = inputs.tex1;
    if (!tex) {
      return;
    }

    const width = tex.width;
    const height = tex.height;
    const depth = params.numFrames;

    if (!runtime.program || depth !== runtime.programDepth) {
      runtime.programDepth = depth;

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

      runtime.program = new ShaderProgram(
        gl,
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
        // the slower version
        runtime.program = new ShaderProgram(
          gl,
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
      runtime.frames.width !== width ||
      runtime.frames.height !== height ||
      runtime.frames.depth !== depth
    ) {
      if (runtime.frames) {
        destroyTex3D(runtime.frames);
      }
      runtime.frames = newTex3D(gl, width, height, depth);
      runtime.head = 0;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, runtime.framebuffer);
    gl.framebufferTextureLayer(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      runtime.frames.texture,
      0,
      runtime.head,
    );

    draw({
      tex,
      targetFramebuffer: runtime.framebuffer,
      viewport: [0, 0, width, height],
    });

    runtime.head = (runtime.head + 1) % runtime.frames.depth;

    ensureFboSize(runtime.outFbo, width, height);

    runtime.program.run({
      viewport: [0, 0, width, height],
      uniforms: {
        uTex3D: ["sampler3D", runtime.frames.texture],
        uDepth: ["1i", runtime.frames.depth],
      },
      fullscreen: true,
      targetFramebuffer: runtime.outFbo.framebuffer,
    });
  },
  destroy({ runtime, ctx }) {
    destroyTex3D(runtime.frames);
    destroyFbo(runtime.outFbo);
    ctx.gl.deleteFramebuffer(runtime.framebuffer);
  },
  Render(props) {
    return (
      <>
        <Sentence>
          Median of last{" "}
          <SentenceParamNumber
            value={props.params.numFrames}
            valueUP={props.paramsUP.numFrames}
            min={1}
            max={91}
            step={2}
          />{" "}
          frames of <props.InputHandle inputKey="tex1" />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
