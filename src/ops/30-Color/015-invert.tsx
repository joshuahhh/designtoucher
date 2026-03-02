import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "invert",
  inputKeys: ["texture"],
  fragBody: `
    vec4 color = texture2D(texture, uv);
    color.rgb = 1.0 - color.rgb;
    gl_FragColor = color;
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Invert <props.InputHandle inputKey="texture" />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
