import { CodeMirrorControlled } from "../../CodeMirrorControlled.js";
import { codeMirrorSetup } from "../../codeMirrorSetup.js";
import { Tex } from "../../mygl.js";
import { AnyOp, defineOp, instantiateOp, Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";
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
  initRuntime() {
    return {
      compiled: null as {
        op: AnyOp;
        opRuntime: any;
        fragBody: string;
      } | null,

      out: null as Tex | null,
    };
  },
  run({ inputs, params, runtime, ctx }) {
    const tex = inputs.tex1;
    if (!tex) {
      return;
    }

    const fragBody = params.fragBody;

    if (!runtime.compiled || runtime.compiled.fragBody !== fragBody) {
      const op = defineFragOp({
        id: "[defined by user]",
        inputKeys: ["tex1"],
        fragBody,
        RenderTop: undefined as any,
      });
      const opInstance = instantiateOp(op, ctx);
      runtime.compiled = {
        op,
        opRuntime: opInstance.runtime,
        fragBody,
      };
      runtime.out = opInstance.runtime.out;
    }

    runtime.compiled.op.run?.({
      ctx,
      inputs: { tex1: tex },
      params: {},
      runtime: runtime.compiled.opRuntime,
    });
  },
  destroy({ runtime, ctx }) {
    if (runtime.compiled) {
      runtime.compiled.op.destroy?.({
        ctx,
        runtime: runtime.compiled.opRuntime,
      });
    }
  },
  RenderTop: (props) => {
    return (
      <>
        <Sentence>
          Run fragment shader on <props.InputHandle inputKey="tex1" />
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
