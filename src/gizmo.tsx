import {
  DraggableRenderer,
  DragSpecBuilder,
  DragStatus,
  lessThan,
  param,
  rotateDeg,
  Svgx,
  translate,
} from "dragology";
import {
  ReactElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TakeSnapshotContext } from "./ops-core.js";

export const ACCENT = "#3b82f6";

export function Gizmo<S extends object>({
  state,
  onState,
  children,
}: {
  state: S;
  onState: (s: S) => void;
  children: (props: {
    state: S;
    d: DragSpecBuilder<S>;
    W: number;
    H: number;
  }) => ReactElement;
}) {
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
    (status: DragStatus<S>) => {
      if (status.type === "dragging") takeSnapshot();
    },
    [takeSnapshot],
  );

  const { width: W, height: H } = size;

  return (
    <div ref={ref} className="h-full">
      <DraggableRenderer
        width={W}
        height={H}
        state={state}
        onDragStatus={onDragStatus}
        onDragState={onState}
        draggable={({ state, d }) => children({ state, d, W, H }) as Svgx}
      />
    </div>
  );
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

type ArrowState = { angle: number; scale: number };

export function ArrowGizmo({
  angle,
  scale,
  onState,
}: {
  angle: number;
  scale?: number;
  onState: (s: { angle: number; scale: number }) => void;
}) {
  const s = scale ?? 1;
  const hasScale = scale !== undefined;
  const state = useMemo(() => ({ angle, scale: s }), [angle, s]);

  return (
    <Gizmo state={state} onState={onState}>
      {({ state, d, W, H }) => {
        const cx = W / 2;
        const cy = H / 2;
        const c = Math.min(cx, cy);
        const halfLen = c * 0.7 * state.scale;
        const a = (state.angle * Math.PI) / 180;
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        const dx = cosA * halfLen;
        const dy = sinA * halfLen;
        const headLen = Math.max(halfLen, 14);
        const hdx = cosA * headLen;
        const hdy = sinA * headLen;

        const varyParams = hasScale
          ? [param<ArrowState>("angle"), param<ArrowState>("scale")]
          : [param<ArrowState>("angle")];

        return (
          <g>
            <line
              x1={cx - dx}
              y1={cy - dy}
              x2={cx + dx}
              y2={cy + dy}
              stroke={ACCENT}
              strokeWidth={2}
              pointerEvents="none"
            />
            <g
              transform={translate(cx + hdx, cy + hdy) + rotateDeg(state.angle)}
              dragologyOnDrag={() =>
                d
                  .vary(state, varyParams, {
                    constraint: (s) => lessThan(0, s.scale),
                  })
                  .during((s) => ({
                    ...s,
                    angle: mod(Math.round(s.angle) + 180, 360) - 180,
                  }))
              }
            >
              <polygon points="0,0 -10,-5 -10,5" fill={ACCENT} />
              <circle r={12} fill="transparent" pointerEvents="all" />
            </g>
          </g>
        );
      }}
    </Gizmo>
  );
}
