import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "simplex-noise",
  initParams() {
    return { strength: 1, size: 0.1, version: 0 };
  },
  fragBody: `
    #include <lygia/generative/snoise.glsl>
    #include <lygia/space/ratio.glsl>

    vec2 uvr = ratio(uv, resolution);
    float noise = snoise(vec3(uvr.x / size, uvr.y / size, version)) * 0.5 + 0.5;
    gl_FragColor = vec4(vec3(noise * strength), 1.0);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Make <b>simplex noise</b> with strength{" "}
          <SentenceParamNumber
            value={props.params.strength}
            valueUP={props.paramsUP.strength}
            min={0}
            max={2}
            step={0.001}
          />{" "}
          , size{" "}
          <SentenceParamNumber
            value={props.params.size}
            valueUP={props.paramsUP.size}
            min={0.01}
            max={0.1}
            step={0.001}
          />{" "}
          , version{" "}
          <SentenceParamNumber
            value={props.params.version}
            valueUP={props.paramsUP.version}
            min={0}
            max={10}
            step={0.01}
          />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
