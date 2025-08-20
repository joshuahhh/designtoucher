import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "kal",
  inputKeys: ["tex1"],
  initParams: () => ({
    strength: 0.1,
    size: 0.03,
  }),
  // TODO: booleans end up as floats in the shader
  fragBody: `
    vec2 uvFlip = uv + vec2(sin(uv.y / size) * strength, cos(uv.x / size) * strength);
    gl_FragColor = texture2D(tex1, uvFlip);
  `,
  RenderTop: (props) => {
    return (
      <Sentence>
        Wiggle <props.InputHandle inputKey="tex1" /> with strength{" "}
        <SentenceParamNumber
          value={props.params.strength}
          valueUP={props.paramsUP.strength}
          min={0}
          max={0.5}
          step={0.001}
        />{" "}
        and size{" "}
        <SentenceParamNumber
          value={props.params.size}
          valueUP={props.paramsUP.size}
          min={0}
          max={0.5}
          step={0.001}
        />
      </Sentence>
    );
  },
});
