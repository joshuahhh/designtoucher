import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "vibrance",
  inputKeys: ["texture"],
  initParams() {
    return { amount: 0 };
  },
  fragBody: `
    vec4 color = texture2D(texture, uv);

    float average = (color.r + color.g + color.b) / 3.0;
    float mx = max(color.r, max(color.g, color.b));
    float amt = (mx - average) * (-amount * 3.0);
    color.rgb = mix(color.rgb, vec3(mx), amt);
    gl_FragColor = color;
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          <props.InputHandle inputKey="texture" /> Vibrance{" "}
          <SentenceParamNumber
            value={props.params.amount}
            valueUP={props.paramsUP.amount}
            min={-1}
            max={1}
            step={0.01}
          />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: [
    "'Vibrance' makes colors more or less intense, kind of like 'saturation'.",
  ],
});
