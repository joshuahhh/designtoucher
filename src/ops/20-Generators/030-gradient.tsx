import {
  DraggableRenderer,
  DragStatus,
  param,
  rotateDeg,
  translate,
} from "dragology";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { UpdateProxy } from "update-proxy";
import {
  Sentence,
  SentenceParamNumber,
  TakeSnapshotContext,
} from "../../ops-core.js";
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
            value={props.params.angle}
            valueUP={props.paramsUP.angle}
            min={0}
            max={360}
            step={0.1}
          />
        </Sentence>
        <props.OutputHandle outputKey="out">
          <AngleArrow
            angle={props.params.angle}
            angleUP={props.paramsUP.angle}
          />
        </props.OutputHandle>
      </>
    );
  },
});

const AngleArrow = ({
  angle,
  angleUP,
}: {
  angle: number;
  angleUP: UpdateProxy<number>;
}) => {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const takeSnapshot = useContext(TakeSnapshotContext);
  const onDragStatus = useCallback(
    (status: DragStatus<{ angle: number }>) => {
      if (status.type === "dragging") takeSnapshot();
    },
    [takeSnapshot],
  );

  const state = useMemo(() => ({ angle }), [angle]);

  return (
    <div ref={ref} className="h-full">
      <DraggableRenderer
        width={size.width}
        height={size.height}
        state={state}
        onDragStatus={onDragStatus}
        onDragState={({ angle }) => angleUP.$set(angle)}
        draggable={({ state, d }) => {
          const cx = size.width / 2;
          const cy = size.height / 2;
          const c = Math.min(cx, cy);
          const len = c * 0.7;
          return (
            <g
              transform={translate(cx, cy) + rotateDeg(state.angle)}
              dragologyOnDrag={() =>
                d
                  .vary(state, [param("angle")])
                  .during((s) => ({ angle: Math.round(s.angle) }))
              }
            >
              <circle r={c} fill="none" pointerEvents="all" />
              <line
                x1={-len}
                y1={0}
                x2={len}
                y2={0}
                stroke="white"
                strokeWidth={2}
              />
              <polygon
                points={`${len},0 ${len - 8},-5 ${len - 8},5`}
                fill="white"
              />
            </g>
          );
        }}
      />
    </div>
  );
};
