import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "brightness-contrast",
  inputKeys: ["texture"],
  initParams() {
    return { brightness: 0, contrast: 0 };
  },
  fragBody: `
    vec4 color = texture2D(texture, uv);
    color.rgb += brightness;
    if (contrast > 0.0) {
      color.rgb = (color.rgb - 0.5) / (1.0 - contrast) + 0.5;
    } else {
      color.rgb = (color.rgb - 0.5) * (1.0 + contrast) + 0.5;
    }
    gl_FragColor = color;
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          <props.InputHandle inputKey="texture" /> Brightness{" "}
          <SentenceParamNumber
            value={props.params.brightness}
            valueUP={props.paramsUP.brightness}
            min={-1}
            max={1}
            step={0.01}
          />
          , Contrast{" "}
          <SentenceParamNumber
            value={props.params.contrast}
            valueUP={props.paramsUP.contrast}
            min={-1}
            max={1}
            step={0.01}
          />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
