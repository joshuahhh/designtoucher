import { EdgeProps, getBezierPath } from "@xyflow/react";
import { createContext, useContext } from "react";

const EDGE_COLOR = "#b8cfe0";

export const PromoteProximityEdgeContext = createContext<
  (
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
  ) => void
>(() => {});

export function ProximityEdge({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const promote = useContext(PromoteProximityEdgeContext);

  const [pathD] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;
  const r = 8;
  const s = 3.5;

  return (
    <g className="proximity-edge-fade">
      <path d={pathD} fill="none" stroke={EDGE_COLOR} strokeWidth={1.5} />
      <g
        className="proximity-edge-button"
        onClick={(e) => {
          e.stopPropagation();
          promote(
            source,
            data?.sourceHandle as string,
            target,
            data?.targetHandle as string,
          );
        }}
        cursor="pointer"
      >
        <circle
          cx={midX}
          cy={midY}
          r={r}
          fill="white"
          stroke={EDGE_COLOR}
          strokeWidth={1.5}
        />
        <line
          x1={midX - s}
          y1={midY}
          x2={midX + s}
          y2={midY}
          stroke={EDGE_COLOR}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <line
          x1={midX}
          y1={midY - s}
          x2={midX}
          y2={midY + s}
          stroke={EDGE_COLOR}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}
