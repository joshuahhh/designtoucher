import clsx from "clsx";
import { inOrder, param, translate } from "dragology";
import { useContext, useMemo } from "react";
import { LuRotateCcw } from "react-icons/lu";
import { UpdateProxy } from "update-proxy";
import { ACCENT, Gizmo } from "../../gizmo.js";
import { Monitor, OmniCanvasOverlay } from "../../OmniCanvas.js";
import {
  Sentence,
  SentenceParamNumber,
  SentenceParamSelect,
  TakeSnapshotContext,
  useInputTex,
} from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

type CropParams = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mode: number;
};

type CropGizmoState = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

const MODE_OPTIONS = [
  { value: 0, label: "in-place" },
  { value: 1, label: "cover" },
  { value: 2, label: "contain" },
];

export default defineFragOp({
  id: "crop",
  inputKeys: ["tex1"],
  initParams: (): CropParams => ({
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
    mode: 0,
  }),
  fragBody: `
    float cw = x2 - x1;
    float ch = y2 - y1;
    float ccx = (x1 + x2) / 2.0;
    float ccy = (y1 + y2) / 2.0;

    float outX = uv.x;
    float outY = 1.0 - uv.y;

    vec2 srcNorm;
    bool inBounds = true;

    if (mode < 0.5) {
      srcNorm = vec2(outX, outY);
      if (outX < x1 || outX > x2 || outY < y1 || outY > y2) {
        inBounds = false;
      }
    } else {
      float invScale;
      if (mode < 1.5) {
        invScale = min(cw, ch);
      } else {
        invScale = max(cw, ch);
      }
      srcNorm = vec2(
        ccx + (outX - 0.5) * invScale,
        ccy + (outY - 0.5) * invScale
      );
      if (srcNorm.x < x1 || srcNorm.x > x2 || srcNorm.y < y1 || srcNorm.y > y2) {
        inBounds = false;
      }
    }

    if (!inBounds || srcNorm.x < 0.0 || srcNorm.x > 1.0 || srcNorm.y < 0.0 || srcNorm.y > 1.0) {
      gl_FragColor = vec4(0.0);
    } else {
      vec2 srcUv = vec2(srcNorm.x, 1.0 - srcNorm.y);
      gl_FragColor = texture2D(tex1, srcUv);
    }
  `,
  Render(props) {
    const { params, paramsUP } = props;
    const takeSnapshot = useContext(TakeSnapshotContext);
    const inputTex = useInputTex("tex1");
    const isInPlace = params.mode === 0;

    const resetDisabled =
      params.x1 === 0 && params.y1 === 0 && params.x2 === 1 && params.y2 === 1;
    const reset = () => {
      takeSnapshot();
      paramsUP.$((p) => ({ ...p, x1: 0, y1: 0, x2: 1, y2: 1 }));
    };

    const paramRow = (
      label: string,
      value: number,
      valueUP: UpdateProxy<number>,
    ) => (
      <div className="flex items-center gap-1">
        <span className="w-9 text-[10px] text-gray-500 select-none">
          {label}
        </span>
        <SentenceParamNumber
          value={value}
          valueUP={valueUP}
          min={0}
          max={1}
          step={0.001}
        />
      </div>
    );

    return (
      <>
        <Sentence>
          Crop <props.InputHandle key="tex1" inputKey="tex1" />{" "}
          <SentenceParamSelect
            value={params.mode}
            valueUP={paramsUP.mode}
            options={MODE_OPTIONS}
          />
        </Sentence>
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-0.5 text-xs font-['Varela_Round']">
            <div className="flex items-center gap-1 rounded bg-black/5 px-1 py-0.5">
              <div className="flex flex-col gap-0.5">
                {paramRow("left", params.x1, paramsUP.x1)}
                {paramRow("right", params.x2, paramsUP.x2)}
                {paramRow("top", params.y1, paramsUP.y1)}
                {paramRow("bottom", params.y2, paramsUP.y2)}
              </div>
              <button
                type="button"
                title="Reset"
                onClick={reset}
                disabled={resetDisabled}
                className={clsx(
                  "nodrag ml-auto flex h-4 w-4 items-center justify-center rounded border text-[10px] transition-colors",
                  resetDisabled
                    ? "opacity-30 pointer-events-none border-gray-200 text-gray-300"
                    : "border-gray-300 text-gray-500 hover:border-blue-400/50 hover:text-blue-600",
                )}
              >
                <LuRotateCcw />
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {!isInPlace && inputTex && (
              <div className="relative" style={{ width: 200 }}>
                <div className="rounded-sm overflow-hidden">
                  <Monitor tex={inputTex} cornerRadiusPixels={3} />
                </div>
                <OmniCanvasOverlay className="absolute left-0 top-0 w-full h-full pointer-events-none">
                  <CropGizmo params={params} paramsUP={paramsUP} />
                </OmniCanvasOverlay>
              </div>
            )}
            <props.OutputHandle outputKey="out">
              {isInPlace && <CropGizmo params={params} paramsUP={paramsUP} />}
            </props.OutputHandle>
          </div>
        </div>
      </>
    );
  },
  searchHints: ["AKA: trim, cut, clip, frame, region."],
});

const bounds = (s: CropGizmoState) => [
  ...inOrder([0, s.x1, s.x2, 1]),
  ...inOrder([0, s.y1, s.y2, 1]),
];

const CORNER_DEFS = [
  { kx: "x1", ky: "y1", cursor: "nwse-resize" },
  { kx: "x2", ky: "y1", cursor: "nesw-resize" },
  { kx: "x2", ky: "y2", cursor: "nwse-resize" },
  { kx: "x1", ky: "y2", cursor: "nesw-resize" },
] as const;

const EDGE_DEFS = [
  { key: "y1", horizontal: true, cursor: "ns-resize" },
  { key: "x2", horizontal: false, cursor: "ew-resize" },
  { key: "y2", horizontal: true, cursor: "ns-resize" },
  { key: "x1", horizontal: false, cursor: "ew-resize" },
] as const;

const CropGizmo = ({
  params,
  paramsUP,
}: {
  params: CropParams;
  paramsUP: UpdateProxy<CropParams>;
}) => {
  const { x1, y1, x2, y2 } = params;
  const state = useMemo(() => ({ x1, y1, x2, y2 }), [x1, y1, x2, y2]);

  return (
    <Gizmo state={state} onState={(s) => paramsUP.$((p) => ({ ...p, ...s }))}>
      {({ state, d, W, H }) => {
        const left = state.x1 * W;
        const top = state.y1 * H;
        const right = state.x2 * W;
        const bottom = state.y2 * H;
        const midX = (left + right) / 2;
        const midY = (top + bottom) / 2;

        const halfW = (state.x2 - state.x1) / 2;
        const halfH = (state.y2 - state.y1) / 2;

        const corners = CORNER_DEFS.map((c) => ({
          x: state[c.kx] * W,
          y: state[c.ky] * H,
          params: [param<CropGizmoState>(c.kx), param<CropGizmoState>(c.ky)],
          cursor: c.cursor,
        }));

        const edges = EDGE_DEFS.map((e) => {
          const isX = e.key === "x1" || e.key === "x2";
          return {
            x: isX ? state[e.key] * W : midX,
            y: isX ? midY : state[e.key] * H,
            params: [param<CropGizmoState>(e.key)],
            horizontal: e.horizontal,
            cursor: e.cursor,
          };
        });

        return (
          <g>
            {/* Dim area outside crop */}
            <path
              d={`M0,0 H${W} V${H} H0Z M${left},${top} V${bottom} H${right} V${top}Z`}
              fill="black"
              fillOpacity={0.3}
              fillRule="evenodd"
              pointerEvents="none"
            />

            {/* Body — drag to translate */}
            <g
              id="body"
              transform={translate(midX, midY)}
              style={{ cursor: "move" }}
              dragologyOnDrag={() =>
                d.varyFunc(
                  [midX / W, midY / H],
                  ([cx, cy]) => ({
                    x1: cx - halfW,
                    y1: cy - halfH,
                    x2: cx + halfW,
                    y2: cy + halfH,
                  }),
                  { constraint: bounds },
                )
              }
            >
              <rect
                x={left - midX}
                y={top - midY}
                width={right - left}
                height={bottom - top}
                fill="transparent"
                stroke={ACCENT}
                strokeWidth={2}
                strokeDasharray="6 3"
                pointerEvents="all"
              />
            </g>

            {/* Edge handles */}
            {edges.map((edge, i) => (
              <g
                key={`edge-${i}`}
                id={`edge-${i}`}
                transform={translate(edge.x, edge.y)}
                style={{ cursor: edge.cursor }}
                dragologyOnDrag={() =>
                  d.vary(state, edge.params, { constraint: bounds })
                }
              >
                {edge.horizontal ? (
                  <rect
                    x={-12}
                    y={-3}
                    width={24}
                    height={6}
                    rx={2}
                    fill={ACCENT}
                    pointerEvents="all"
                  />
                ) : (
                  <rect
                    x={-3}
                    y={-12}
                    width={6}
                    height={24}
                    rx={2}
                    fill={ACCENT}
                    pointerEvents="all"
                  />
                )}
              </g>
            ))}

            {/* Corner handles */}
            {corners.map((corner, i) => (
              <g
                key={`corner-${i}`}
                id={`corner-${i}`}
                transform={translate(corner.x, corner.y)}
                style={{ cursor: corner.cursor }}
                dragologyOnDrag={() =>
                  d.vary(state, corner.params, { constraint: bounds })
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
