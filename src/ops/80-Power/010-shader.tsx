import { CodeMirrorControlled } from "../../CodeMirrorControlled.js";
import { codeMirrorSetup } from "../../codeMirrorSetup.js";
import { Tex } from "../../mygl.js";
import {
  anyOpInstance,
  AnyOpInstance,
  defineOp,
  Sentence,
} from "../../ops-core.js";
import { instantiateOp } from "../../ops-flow.js";
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
        opInstance: AnyOpInstance;
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
        Render: undefined as any,
      });
      const opInstance = instantiateOp(op, ctx, "constant-op");
      runtime.compiled = { opInstance: anyOpInstance(opInstance), fragBody };
      runtime.out = opInstance.runtime.out;
    }

    const { runtime: fragRuntime, getOp: getFragOp } =
      runtime.compiled.opInstance;
    getFragOp().run?.({
      ctx,
      inputs: { tex1: tex },
      params: {},
      runtime: fragRuntime,
    });
  },
  destroy({ runtime, ctx }) {
    if (runtime.compiled) {
      const { runtime: fragRuntime, getOp: getFragOp } =
        runtime.compiled.opInstance;
      getFragOp().destroy?.({
        ctx,
        runtime: fragRuntime,
      });
    }
  },
  Render(props) {
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
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
