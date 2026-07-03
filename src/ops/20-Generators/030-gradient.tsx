import { ArrowGizmo } from "../../gizmo.js";
import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "gradient",
  initParams() {
    return { angle: 0 };
  },
  fragBody: `
    float angleRad = radians(angle);
    vec2 uvNorm = uv - 0.5;
    float x = cos(angleRad) * uvNorm.x - sin(angleRad) * uvNorm.y;
    gl_FragColor = vec4(vec3(x + 0.5), 1.0);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Make <b>gradient</b> with angle{" "}
          <SentenceParamNumber
            paramKey="angle"
            value={props.params.angle}
            valueUP={props.paramsUP.angle}
            min={0}
            max={360}
            step={1}
          />
          <span className="text-[10px] text-gray-400 select-none">°</span>
        </Sentence>
        <props.OutputHandle outputKey="out">
          <ArrowGizmo
            angle={props.params.angle}
            onState={(s) => props.paramsUP.angle.$set(s.angle)}
          />
        </props.OutputHandle>
      </>
    );
  },
});
