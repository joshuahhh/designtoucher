import { Sentence, SentenceParamColor } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "tint",
  inputKeys: ["texture"],
  initParams() {
    return { r: 1, g: 0.8, b: 0.5 };
  },
  fragBody: `
    vec4 color = texture2D(texture, uv);
    float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(lum * r, lum * g, lum * b, color.a);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Tint <props.InputHandle inputKey="texture" />
          {" with "}
          <SentenceParamColor
            r={props.params.r}
            g={props.params.g}
            b={props.params.b}
            rUP={props.paramsUP.r}
            gUP={props.paramsUP.g}
            bUP={props.paramsUP.b}
          />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
