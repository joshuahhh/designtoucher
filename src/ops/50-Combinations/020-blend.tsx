import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "blend",
  inputKeys: ["tex1", "tex2"],
  initParams: () => ({ ratio: 0.5 }),
  fragBody: `
    vec4 tex1Color = texture2D(tex1, uv);
    vec4 tex2Color = texture2D(tex2, uv);
    gl_FragColor = mix(tex1Color, tex2Color, ratio);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Blend <props.InputHandle inputKey="tex1" /> and{" "}
          <props.InputHandle inputKey="tex2" /> at{" "}
          <SentenceParamNumber
            paramKey="ratio"
            value={props.params.ratio}
            valueUP={props.paramsUP.ratio}
            min={0}
            max={1}
            step={0.001}
          />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["AKA: mix, interpolate."],
});
