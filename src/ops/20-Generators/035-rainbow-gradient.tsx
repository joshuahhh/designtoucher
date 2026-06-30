import { ReactNode } from "react";
import { ArrowGizmo } from "../../gizmo.js";
import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "rainbow-gradient",
  initParams() {
    return { angle: 0, scale: 1, offset: 0, saturation: 1.5 };
  },
  fragBody: `
    float angleRad = radians(angle);
    vec2 uvNorm = uv - 0.5;
    float x = cos(angleRad) * uvNorm.x - sin(angleRad) * uvNorm.y;
    float h = (x / max(scale, 0.001) + 0.5 + offset) * 6.28318;

    // OKLCH -> OKLab -> linear sRGB
    float L = 0.8;
    float C = 0.15 * saturation;
    float aa = C * cos(h);
    float bb = C * sin(h);

    float l_ = L + 0.3963377774 * aa + 0.2158037573 * bb;
    float m_ = L - 0.1055613458 * aa - 0.0638541728 * bb;
    float s_ = L - 0.0894841775 * aa - 1.2914855480 * bb;

    float l3 = l_ * l_ * l_;
    float m3 = m_ * m_ * m_;
    float s3 = s_ * s_ * s_;

    float r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
    float g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
    float b = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

    gl_FragColor = vec4(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), 1.0);
  `,
  Render(props) {
    const { params, paramsUP } = props;
    return (
      <>
        <Sentence>
          Make <b>rainbow gradient</b>
        </Sentence>
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-0.5 text-xs font-['Varela_Round']">
            <ParamRow label="angle">
              <SentenceParamNumber
                value={params.angle}
                valueUP={paramsUP.angle}
                min={0}
                max={360}
                step={1}
              />
              <span className="text-[10px] text-gray-400 select-none">°</span>
            </ParamRow>
            <ParamRow label="scale">
              <SentenceParamNumber
                value={params.scale}
                valueUP={paramsUP.scale}
                min={0.01}
                max={4}
                step={0.01}
              />
            </ParamRow>
            <ParamRow label="offset">
              <SentenceParamNumber
                value={params.offset}
                valueUP={paramsUP.offset}
                min={-2}
                max={2}
                step={0.01}
              />
            </ParamRow>
            <ParamRow label="saturation">
              <SentenceParamNumber
                value={params.saturation}
                valueUP={paramsUP.saturation}
                min={0}
                max={3}
                step={0.01}
              />
            </ParamRow>
          </div>
          <props.OutputHandle outputKey="out">
            <ArrowGizmo
              angle={params.angle}
              scale={params.scale}
              onState={(s) => {
                paramsUP.angle.$set(s.angle);
                paramsUP.scale.$set(s.scale);
              }}
            />
          </props.OutputHandle>
        </div>
      </>
    );
  },
});

const ParamRow = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="flex items-center gap-1 rounded bg-black/5 px-1 py-0.5">
    <span className="w-16 text-[10px] text-gray-500 select-none">{label}</span>
    {children}
  </div>
);
