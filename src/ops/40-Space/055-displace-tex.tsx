import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "displace-tex",
  inputKeys: ["tex1", "tex2", "tex3"],
  fragBody: `
    float x = texture2D(tex2, uv).r;
    float y = texture2D(tex3, uv).r;
    vec2 newUV = uv + vec2(x, y) / 3.0;
    if (newUV.x < 0.0 || newUV.x > 1.0 || newUV.y < 0.0 || newUV.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
      gl_FragColor = texture2D(tex1, newUV);
    }
  `,
  RenderTop: (props) => {
    return (
      <Sentence>
        Displace <props.Handle key="tex1" handleKey="tex1" /> by X:{" "}
        <props.Handle key="tex2" handleKey="tex2" /> Y:{" "}
        <props.Handle key="tex3" handleKey="tex3" />
      </Sentence>
    );
  },
});
