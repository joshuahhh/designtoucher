import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "scale-around-half",
  inputKeys: ["texture"],
  initParams: () => ({ scale: 1 }),
  fragBody: `
    vec4 color = texture2D(texture, uv);
    color.rgb = (color.rgb - 128.0 / 255.0) * scale + 128.0 / 255.0;
    gl_FragColor = color;
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Scale <props.InputHandle inputKey="texture" /> around 0.5 by{" "}
          <SentenceParamNumber
            paramKey="scale"
            value={props.params.scale}
            valueUP={props.paramsUP.scale}
            min={-10}
            max={10}
            step={0.1}
          />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
