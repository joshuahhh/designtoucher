import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "lfo",
  initParams() {
    return { amplitude: 1, period: 1, phase: 0 };
  },
  fragBody: `
    float t = mod(time, period) / period;
    float value = (sin(t * 2.0 * 3.14159 + phase * 3.14159 / 180.0) + 1.0) * amplitude / 2.0;
    gl_FragColor = vec4(value, value, value, 1.0);
  `,
  RenderTop: (props) => {
    return (
      <Sentence>
        Oscillate with amplitude{" "}
        <SentenceParamNumber
          value={props.params.amplitude}
          valueUP={props.paramsUP.amplitude}
          min={0}
          max={1}
          step={0.001}
        />{" "}
        , period{" "}
        <SentenceParamNumber
          value={props.params.period}
          valueUP={props.paramsUP.period}
          min={0.01}
          max={10}
          step={0.001}
        />{" "}
        , phase{" "}
        <SentenceParamNumber
          value={props.params.phase}
          valueUP={props.paramsUP.phase}
          min={-180}
          max={180}
          step={0.1}
        />
      </Sentence>
    );
  },
});
