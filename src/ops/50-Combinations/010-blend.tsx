import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "blend",
  inputKeys: ["tex1", "tex2"],
  initParams: () => ({ ratio: 0.5 }),
  fragBody: `
    vec3 tex1Color = vec3(texture2D(tex1, uv));
    vec3 tex2Color = vec3(texture2D(tex2, uv));
    gl_FragColor = vec4(mix(tex1Color, tex2Color, ratio), 1.0);
  `,
  RenderTop: (props) => {
    return (
      <Sentence>
        Blend <props.Handle handleKey="tex1" /> and{" "}
        <props.Handle handleKey="tex2" /> at{" "}
        <SentenceParamNumber
          value={props.params.ratio}
          valueUP={props.paramsUP.ratio}
          min={0}
          max={1}
          step={0.001}
        />
      </Sentence>
    );
  },
  searchHints: ["AKA: mix, interpolate."],
});
