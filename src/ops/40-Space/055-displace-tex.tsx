import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "displace-tex",
  inputKeys: ["tex1", "tex2", "tex3"],
  fragBody: `
    vec4 color2 = texture2D(tex2, uv);
    float x = (color2.r + color2.g + color2.b) * color2.a;
    vec4 color3 = texture2D(tex3, uv);
    float y = (color3.r + color3.g + color3.b) * color3.a;
    vec2 newUV = uv + vec2(x, y) / 3.0;
    if (newUV.x < 0.0 || newUV.x > 1.0 || newUV.y < 0.0 || newUV.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
      gl_FragColor = texture2D(tex1, newUV);
    }
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Displace <props.InputHandle key="tex1" inputKey="tex1" /> by X:{" "}
          <props.InputHandle key="tex2" inputKey="tex2" /> Y:{" "}
          <props.InputHandle key="tex3" inputKey="tex3" />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});

const x = defineFragOp({
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
  Render(props) {
    return (
      <>
        <Sentence>
          Displace <props.InputHandle key="tex1" inputKey="tex1" /> by X:{" "}
          <props.InputHandle key="tex2" inputKey="tex2" /> Y:{" "}
          <props.InputHandle key="tex3" inputKey="tex3" />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
