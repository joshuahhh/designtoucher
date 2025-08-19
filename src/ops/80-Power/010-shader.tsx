import { CodeMirrorControlled } from "../../CodeMirrorControlled.js";
import { codeMirrorSetup } from "../../codeMirrorSetup.js";
import {
  destroyFbo,
  ensureFboSize,
  newFbo,
  ShaderProgram,
} from "../../mygl.js";
import { defineOp, Sentence } from "../../ops-core.js";
import { strip } from "../../util.js";

export default defineOp({
  id: "shader",
  inputKeys: ["tex1"],
  initParams: () => ({
    fragBody: strip`
      vec3 tex1Color = vec3(texture2D(tex1, uv));
      gl_FragColor = vec4(tex1Color * 2.0, 1.0);
    `,
  }),
  initRuntime(ctx) {
    const outFbo = newFbo(ctx.gl);

    return {
      compiled: null as {
        program: ShaderProgram;
        fragBody: string;
      } | null,

      outFbo: outFbo,
      out: outFbo.tex,
    };
  },
  run({ inputs, params, runtime, ctx }) {
    const { gl } = ctx;
    const tex = inputs.tex1;
    if (!tex) {
      return;
    }

    const fragBody = params.fragBody;

    if (!runtime.compiled || runtime.compiled.fragBody !== fragBody) {
      // compile the shader
      const fragSrc =
        `precision mediump float;\n` +
        `uniform sampler2D tex1;\n` +
        `uniform float time;\n` +
        `varying vec2 uv;\n` +
        `// lygia-includes\n` +
        `void main(){\n${fragBody}\n}`;
      const vertSrc = `
          attribute vec2 position; varying vec2 uv;
          void main(){ uv = 0.5*(position+1.0); gl_Position = vec4(position,0.0,1.0); }
        `;
      runtime.compiled = {
        program: new ShaderProgram(gl, vertSrc, fragSrc),
        fragBody,
      };
    }

    ensureFboSize(runtime.outFbo, tex.width, tex.height);

    runtime.compiled.program.run({
      viewport: [0, 0, tex.width, tex.height],
      uniforms: {
        tex1: ["sampler2D", tex.texture],
        time: ["1f", performance.now() / 1000],
      },
      fullscreen: true,
      targetFramebuffer: runtime.outFbo.framebuffer,
    });
  },
  destroy({ runtime }) {
    destroyFbo(runtime.outFbo);
  },
  RenderTop: (props) => {
    return (
      <>
        <Sentence>
          Run fragment shader on <props.Handle handleKey="tex1" />
        </Sentence>
        <CodeMirrorControlled
          className="nodrag text-xs"
          value={props.params.fragBody}
          extensions={codeMirrorSetup}
          setValue={props.paramsUP.fragBody.$set}
        />
      </>
    );
  },
});
