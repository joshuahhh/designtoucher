import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "plus",
  inputKeys: ["tex1", "tex2"],
  initParams: () => ({ alpha: 0 }),
  fragBody: `
    vec3 tex1Color = vec3(texture2D(tex1, uv));
    vec3 tex2Color = vec3(texture2D(tex2, uv));
    gl_FragColor = vec4(tex1Color + tex2Color + alpha, 1.0);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Math: <props.InputHandle inputKey="tex1" /> +{" "}
          <props.InputHandle inputKey="tex2" /> ( +{" "}
          <SentenceParamNumber
            value={props.params.alpha}
            valueUP={props.paramsUP.alpha}
            min={-1}
            max={1}
            step={0.001}
          />
          )
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["AKA: plus, add."],
});
