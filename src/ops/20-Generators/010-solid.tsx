import { Sentence, SentenceParamColor } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "solid",
  initParams() {
    return { r: 1, g: 0, b: 0, a: 1 };
  },
  fragBody: `
    gl_FragColor = vec4(r, g, b, a);
  `,
  Render(props) {
    const { r, g, b, a } = props.params;

    return (
      <>
        <Sentence>
          Solid color:{" "}
          <SentenceParamColor
            r={r}
            g={g}
            b={b}
            a={a}
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
