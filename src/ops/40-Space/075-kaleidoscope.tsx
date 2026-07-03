import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "kaleidoscope",
  inputKeys: ["tex1"],
  initParams: () => ({
    n: 6,
  }),
  fragBody: `
    vec2 center = uv - 0.5;
    float angle = atan(center.y, center.x);
    float radius = length(center);
    float slice = 3.14159265 * 2.0 / n;
    angle = mod(angle, slice);
    if (angle > slice / 2.0) angle = slice - angle;
    vec2 kalUv = vec2(cos(angle), sin(angle)) * radius + 0.5;
    gl_FragColor = texture2D(tex1, kalUv);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Kaleidoscope <props.InputHandle inputKey="tex1" /> with{" "}
          <SentenceParamNumber
            paramKey="n"
            value={props.params.n}
            valueUP={props.paramsUP.n}
            min={2}
            max={24}
            step={1}
          />{" "}
          slices
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
