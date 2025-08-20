import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "times",
  inputKeys: ["tex1", "tex2"],
  initParams: () => ({ alpha: 1 }),
  fragBody: `
    vec4 tex1b = has_tex1 == 1 ? texture2D(tex1, uv) : vec4(1.0);
    vec4 tex2b = has_tex2 == 1 ? texture2D(tex2, uv) : vec4(1.0);
    gl_FragColor = tex1b * tex2b * vec4(alpha, alpha, alpha, 1.0);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Math: <props.InputHandle inputKey="tex1" /> ✕{" "}
          <props.InputHandle inputKey="tex2" /> ( ✕{" "}
          <SentenceParamNumber
            value={props.params.alpha}
            valueUP={props.paramsUP.alpha}
            min={0}
            max={10}
            step={0.001}
          />
          )
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["AKA: times, multiply."],
});
