import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "diff",
  inputKeys: ["tex1", "tex2"],
  fragBody: `
    vec3 tex1Color = vec3(texture2D(tex1, uv));
    vec3 tex2Color = vec3(texture2D(tex2, uv));
    gl_FragColor = vec4(abs(tex1Color - tex2Color), 1.0);
  `,
  RenderTop: (props) => {
    return (
      <Sentence>
        Math: |<props.Handle handleKey="tex1" /> -
        <props.Handle handleKey="tex2" />|
      </Sentence>
    );
  },
  searchHints: ["AKA: minus, subtract, difference."],
});
