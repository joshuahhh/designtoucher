import { Tex } from "../../mygl.js";
import { defineOp, Sentence, SentenceParamNumber } from "../../ops-core.js";

export default defineOp({
  id: "switch",
  inputKeys: ["tex1", "tex2", "tex3"],
  initParams: () => ({ inputIndex: 0 }),
  initRuntime: () => {
    return {
      out: null as Tex | null,
    };
  },
  run({ inputs, params, runtime }) {
    runtime.out = inputs[`tex${(params.inputIndex + 1) as 1 | 2 | 3}`];
  },
  RenderTop: (props) => {
    return (
      <Sentence>
        Switch to <props.Handle handleKey="tex1" />{" "}
        <props.Handle handleKey="tex2" /> <props.Handle handleKey="tex3" />{" "}
        <SentenceParamNumber
          value={props.params.inputIndex}
          valueUP={props.paramsUP.inputIndex}
          min={0}
          max={2}
          step={1}
        />
      </Sentence>
    );
  },
});
