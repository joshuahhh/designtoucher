import {
  destroyFbo,
  destroyTex3D,
  ensureFboSize,
  newFbo,
  newTex3D,
  ShaderProgram,
} from "../../mygl.js";
import { defineOp, Sentence, SentenceParamNumber } from "../../ops-core.js";

export default defineOp({
  id: "time-machine",
  inputKeys: ["tex1", "tex2"],
  initParams: () => ({
    numFrames: 100,
  }),
  initRuntime(ctx) {
    const outFbo = newFbo(ctx.gl);

    return {
      frames: newTex3D(ctx.gl, 1, 1, 1),
      head: 0,
      framebuffer: ctx.gl.createFramebuffer(),

      program: new ShaderProgram(
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
      ),

      outFbo: outFbo,
      out: outFbo.tex,
    };
  },
  run({ inputs, params, runtime, ctx }) {
    const { gl, draw } = ctx;
    const tex = inputs.tex1;
    const idxTex = inputs.tex2;
    if (!tex || !idxTex) {
      return;
    }

    const width = tex.width;
    const height = tex.height;
    const depth = params.numFrames;

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
        uIndex: ["sampler2D", idxTex.texture],
        uHead: ["1i", runtime.head],
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
          Delay <props.InputHandle inputKey="tex1" /> up to{" "}
          <SentenceParamNumber
            value={props.params.numFrames}
            valueUP={props.paramsUP.numFrames}
            min={1}
            max={200}
            step={1}
          />{" "}
          frames based on <props.InputHandle inputKey="tex2" />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
