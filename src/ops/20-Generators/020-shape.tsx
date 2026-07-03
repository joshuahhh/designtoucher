import {
  Sentence,
  SentenceParamNumber,
  SentenceParamSelect,
} from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "shape",
  initParams() {
    return { shape: "circle" as "circle", size: 0.5 };
  },
  fragBody: `
    #include <lygia/space/ratio.glsl>

    vec2 uvr = ratio(uv, resolution) - vec2(0.5, 0.5);
    gl_FragColor = length(uvr) < size / 2.0 ? vec4(1.0) : vec4(0.0);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Make{" "}
          <SentenceParamSelect<typeof props.params.shape>
            value={props.params.shape}
            valueUP={props.paramsUP.shape}
            options={["circle"]}
          />{" "}
          with size{" "}
          <SentenceParamNumber
            paramKey="size"
            value={props.params.size}
            valueUP={props.paramsUP.size}
            min={0}
            max={3}
            step={0.01}
          />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
