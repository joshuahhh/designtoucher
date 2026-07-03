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
  Render(props) {
    return (
      <>
        <Sentence>
          Switch to <props.InputHandle inputKey="tex1" />{" "}
          <props.InputHandle inputKey="tex2" />{" "}
          <props.InputHandle inputKey="tex3" />{" "}
          <SentenceParamNumber
            paramKey="inputIndex"
            value={props.params.inputIndex}
            valueUP={props.paramsUP.inputIndex}
            min={0}
            max={2}
            step={1}
          />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["AKA: pick, choose."],
});
