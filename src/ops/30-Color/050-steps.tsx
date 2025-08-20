import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "steps",
  inputKeys: ["tex1"],
  initParams() {
    return { steps: 10 };
  },
  fragBody: `
    vec3 tex1Color = vec3(texture2D(tex1, uv));
    float stepSize = 1.0 / float(steps);
    tex1Color = floor(tex1Color / stepSize) * stepSize;
    gl_FragColor = vec4(tex1Color, 1.0);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Break color channels of <props.InputHandle inputKey="tex1" /> into{" "}
          <SentenceParamNumber
            value={props.params.steps}
            valueUP={props.paramsUP.steps}
            min={1}
            max={20}
            step={1}
          />{" "}
          steps
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["AKA: posterize, quantize.", "Makes a cartoon effect."],
});
