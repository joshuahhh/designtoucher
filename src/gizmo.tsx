import {
  DraggableRenderer,
  DragSpecBuilder,
  DragStatus,
  Svgx,
} from "dragology";
import {
  ReactElement,
  useCallback,
  useContext,
  useEffect,
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
