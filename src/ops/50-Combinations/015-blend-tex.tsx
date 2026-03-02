import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "blend-tex",
  inputKeys: ["tex1", "tex2", "mask"],
  fragBody: `
    vec3 tex1Color = vec3(texture2D(tex1, uv));
    vec3 tex2Color = vec3(texture2D(tex2, uv));
    float ratio = texture2D(mask, uv).r;
    gl_FragColor = vec4(mix(tex1Color, tex2Color, ratio), 1.0);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Blend <props.InputHandle inputKey="tex1" /> and{" "}
          <props.InputHandle inputKey="tex2" /> using{" "}
          <props.InputHandle inputKey="mask" />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["AKA: mix, interpolate, mask, matte."],
});
