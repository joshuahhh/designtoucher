import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "tint-image",
  inputKeys: ["texture", "color"],
  fragBody: `
    vec4 src = texture2D(texture, uv);
    float lum = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec4 tintColor = has_color == 1 ? texture2D(color, uv) : vec4(1.0);
    vec3 tinted = lum * tintColor.rgb;
    gl_FragColor = vec4(mix(src.rgb, tinted, tintColor.a), src.a);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Tint <props.InputHandle inputKey="texture" />
          {" with "}
          <props.InputHandle inputKey="color" />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
