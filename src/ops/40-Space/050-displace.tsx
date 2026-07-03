import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "displace",
  inputKeys: ["tex1"],
  initParams: () => ({ x: 0, y: 0 }),
  fragBody: `
    vec2 newUV = uv - vec2(x, y);
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
          <SentenceParamNumber
            paramKey="x"
            value={props.params.x}
            valueUP={props.paramsUP.x}
            min={-1}
            max={1}
            step={0.001}
          />{" "}
          Y:{" "}
          <SentenceParamNumber
            paramKey="y"
            value={props.params.y}
            valueUP={props.paramsUP.y}
            min={-1}
            max={1}
            step={0.001}
          />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
