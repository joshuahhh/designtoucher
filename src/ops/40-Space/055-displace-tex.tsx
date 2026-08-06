import { Sentence, SentenceParamSelect } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

const MODE_OPTIONS = [
  { value: 0, label: "black = 0" },
  { value: 1, label: "gray = 0" },
];

export default defineFragOp({
  id: "displace-tex",
  inputKeys: ["tex1", "tex2", "tex3"],
  initParams: () => ({ mode: 0 }),
  fragBody: `
    float x = 0.0;
    if (has_tex2 == 1) {
      vec4 color2 = texture2D(tex2, uv);
      x = (color2.r + color2.g + color2.b) * color2.a / 3.0;
    }
    float y = 0.0;
    if (has_tex3 == 1) {
      vec4 color3 = texture2D(tex3, uv);
      y = (color3.r + color3.g + color3.b) * color3.a / 3.0;
    }
    if (mode > 0.5) {
      x = (x - 128.0 / 255.0) * 2.0;
      y = (y - 128.0 / 255.0) * 2.0;
    }
    vec2 newUV = uv + vec2(x, y);
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
          <props.InputHandle key="tex3" inputKey="tex3" />{" "}
          <SentenceParamSelect
            value={props.params.mode}
            valueUP={props.paramsUP.mode}
            options={MODE_OPTIONS}
          />
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
