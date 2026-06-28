import clsx from "clsx";
import { param, translate } from "dragology";
import { ReactNode, useContext, useMemo } from "react";
import { LuRotateCcw } from "react-icons/lu";
import { UpdateProxy } from "update-proxy";
import { ACCENT, Gizmo } from "../../gizmo.js";
import {
  Sentence,
  SentenceParamNumber,
  TakeSnapshotContext,
} from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

type TransformParams = {
  scaleX: number;
  scaleY: number;
  angle: number;
  tx: number;
  ty: number;
};

export default defineFragOp({
  id: "transform",
  inputKeys: ["tex1"],
  initParams: (): TransformParams => ({
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    tx: 0,
    ty: 0,
  }),
  // Forward transform (applied to the image): scale about center, then
  // rotate about center, then translate. We work in image-pixel space
  // (uv * resolution, y pointing down like the screen) so rotation is
  // rigid. For each output fragment we apply the inverse transform to
  // find which source pixel lands here.
  fragBody: `
    vec2 res = resolution;
    vec2 Q = vec2(uv.x, 1.0 - uv.y) * res;
    vec2 O = res * 0.5;
    vec2 d = Q - O - vec2(tx * res.x, ty * res.y);
    float a = radians(angle);
    float c = cos(a);
    float s = sin(a);
    // inverse rotation R(-a)
    vec2 e = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
    vec2 f = vec2(e.x / scaleX, e.y / scaleY);
    vec2 P = O + f;
    vec2 srcUv = vec2(P.x / res.x, 1.0 - P.y / res.y);
    if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
      gl_FragColor = vec4(0.0);
    } else {
      gl_FragColor = texture2D(tex1, srcUv);
    }
  `,
  Render(props) {
    const { params, paramsUP } = props;
    const takeSnapshot = useContext(TakeSnapshotContext);

    const reset = (apply: (p: TransformParams) => TransformParams) => () => {
      takeSnapshot();
      paramsUP.$(apply);
    };

    return (
      <>
        <Sentence>
          Transform <props.InputHandle key="tex1" inputKey="tex1" />
        </Sentence>
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-0.5 text-xs font-['Varela_Round']">
            <StepRow
              label="scale"
              onReset={reset((p) => ({ ...p, scaleX: 1, scaleY: 1 }))}
              resetDisabled={params.scaleX === 1 && params.scaleY === 1}
            >
              <div className="flex flex-col gap-0.5">
                <Axis label="X">
                  <SentenceParamNumber
                    value={params.scaleX}
                    valueUP={paramsUP.scaleX}
                    min={-4}
                    max={4}
                    step={0.001}
                  />
                </Axis>
                <Axis label="Y">
                  <SentenceParamNumber
                    value={params.scaleY}
                    valueUP={paramsUP.scaleY}
                    min={-4}
                    max={4}
                    step={0.001}
                  />
                </Axis>
              </div>
            </StepRow>

            <StepRow
              label="rotate"
              onReset={reset((p) => ({ ...p, angle: 0 }))}
              resetDisabled={params.angle === 0}
            >
              <SentenceParamNumber
                value={params.angle}
                valueUP={paramsUP.angle}
                min={-180}
                max={180}
                step={0.1}
              />
              <span className="text-[10px] text-gray-400 select-none">°</span>
            </StepRow>

            <StepRow
              label="move"
              onReset={reset((p) => ({ ...p, tx: 0, ty: 0 }))}
              resetDisabled={params.tx === 0 && params.ty === 0}
            >
              <div className="flex flex-col gap-0.5">
                <Axis label="X">
                  <SentenceParamNumber
                    value={params.tx}
                    valueUP={paramsUP.tx}
                    min={-1}
                    max={1}
                    step={0.001}
                  />
                </Axis>
                <Axis label="Y">
                  <SentenceParamNumber
                    value={params.ty}
                    valueUP={paramsUP.ty}
                    min={-1}
                    max={1}
                    step={0.001}
                  />
                </Axis>
              </div>
            </StepRow>
          </div>

          <props.OutputHandle outputKey="out">
            <TransformGizmo params={params} paramsUP={paramsUP} />
          </props.OutputHandle>
        </div>
      </>
    );
  },
  searchHints: ["AKA: move, scale, resize, rotate, translate, position."],
});

// Round to `decimals` places. Dividing by an integer power of ten (rather
// than multiplying by a fractional step) avoids float artifacts like
// 0.70100000000001 that would otherwise widen the sentence layout.
const round = (v: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

// One labelled axis cell, e.g. "X [number]".
const Axis = ({ label, children }: { label: string; children: ReactNode }) => (
  <span className="inline-flex items-center gap-0.5">
    <span className="text-[10px] text-gray-400 select-none">{label}</span>
    {children}
  </span>
);

const ResetButton = ({
  onReset,
  disabled,
}: {
  onReset: () => void;
  disabled: boolean;
}) => (
  <button
    type="button"
    title="Reset"
    onClick={onReset}
    disabled={disabled}
    className={clsx(
      "nodrag ml-auto flex h-4 w-4 items-center justify-center rounded border text-[10px] transition-colors",
      disabled
        ? "opacity-30 pointer-events-none border-gray-200 text-gray-300"
        : "border-gray-300 text-gray-500 hover:border-blue-400/50 hover:text-blue-600",
    )}
  >
    <LuRotateCcw />
  </button>
);

// One step of the transform, laid out as a row with a label, its controls,
// and a reset button pushed to the right.
const StepRow = ({
  label,
  onReset,
  resetDisabled,
  children,
}: {
  label: string;
  onReset: () => void;
  resetDisabled: boolean;
  children: ReactNode;
}) => (
  <div className="flex items-center gap-1 rounded bg-black/5 px-1 py-0.5">
    <span className="w-11 text-[10px] text-gray-500 select-none">{label}</span>
    {children}
    <ResetButton onReset={onReset} disabled={resetDisabled} />
  </div>
);

const TransformGizmo = ({
  params,
  paramsUP,
}: {
  params: TransformParams;
  paramsUP: UpdateProxy<TransformParams>;
}) => {
  const { scaleX, scaleY, angle, tx, ty } = params;
  const state = useMemo(
    () => ({ scaleX, scaleY, angle, tx, ty }),
    [scaleX, scaleY, angle, tx, ty],
  );

  return (
    <Gizmo state={state} onState={(s) => paramsUP.$set(s)}>
      {({ state, d, W, H }) => {
        const a = (state.angle * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);

        const proj = (nx: number, ny: number) => {
          const rx = nx * (W / 2) * state.scaleX;
          const ry = ny * (H / 2) * state.scaleY;
          return {
            x: W / 2 + (cos * rx - sin * ry) + state.tx * W,
            y: H / 2 + (sin * rx + cos * ry) + state.ty * H,
          };
        };

        const center = proj(0, 0);
        const corners = [
          { nx: -1, ny: -1 },
          { nx: 1, ny: -1 },
          { nx: 1, ny: 1 },
          { nx: -1, ny: 1 },
        ].map((n) => proj(n.nx, n.ny));

        const bodyPoints = corners
          .map((p) => `${p.x - center.x},${p.y - center.y}`)
          .join(" ");

        const topMid = proj(0, -1);
        let ux = topMid.x - center.x;
        let uy = topMid.y - center.y;
        const ulen = Math.hypot(ux, uy) || 1;
        ux /= ulen;
        uy /= ulen;
        const ARM = 14;
        const knob = { x: topMid.x + ux * ARM, y: topMid.y + uy * ARM };

        return (
          <g>
            <g
              id="body"
              transform={translate(center.x, center.y)}
              dragologyOnDrag={() => d.vary(state, [param("tx"), param("ty")])}
            >
              <polygon
                points={bodyPoints}
                fill="none"
                stroke={ACCENT}
                strokeWidth={2}
                pointerEvents="stroke"
              />
            </g>

            <line
              x1={topMid.x}
              y1={topMid.y}
              x2={knob.x}
              y2={knob.y}
              stroke={ACCENT}
              strokeWidth={2}
            />
            <g
              id="rotate"
              transform={translate(knob.x, knob.y)}
              dragologyOnDrag={() => d.vary(state, [param("angle")])}
            >
              <circle r={6} fill={ACCENT} pointerEvents="all" />
            </g>

            {corners.map((p, i) => (
              <g
                key={i}
                id={`corner-${i}`}
                transform={translate(p.x, p.y)}
                dragologyOnDrag={() =>
                  d.vary(state, [param("scaleX"), param("scaleY")])
                }
              >
                <circle r={6} fill={ACCENT} pointerEvents="all" />
              </g>
            ))}
          </g>
        );
      }}
    </Gizmo>
  );
};
