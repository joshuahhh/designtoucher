import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "layer",
  inputKeys: ["tex1", "tex2"],
  fragBody: `
    vec4 A = texture2D(tex2, uv); // below
    vec4 B = texture2D(tex1, uv); // above
    float outA = B.a + A.a * (1.0 - B.a);
    vec3 outRGB = (B.rgb * B.a + A.rgb * A.a * (1.0 - B.a)) / max(outA, 1e-6);
    gl_FragColor = vec4(outRGB, outA);
  `,
  RenderTop: (props) => {
    return (
      <Sentence>
        Layer <props.InputHandle inputKey="tex1" /> over{" "}
        <props.InputHandle inputKey="tex2" />
      </Sentence>
    );
  },
});
