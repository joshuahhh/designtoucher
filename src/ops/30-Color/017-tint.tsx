import { Sentence, SentenceParamColor } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "tint",
  inputKeys: ["texture"],
  initParams() {
    return { r: 1, g: 0.8, b: 0.5, a: 1 };
  },
  fragBody: `
    vec4 src = texture2D(texture, uv);
    float lum = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 tinted = lum * vec3(r, g, b);
    gl_FragColor = vec4(mix(src.rgb, tinted, a), src.a);
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
            a={props.params.a}
            rUP={props.paramsUP.r}
            gUP={props.paramsUP.g}
            bUP={props.paramsUP.b}
            aUP={props.paramsUP.a}
          />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
