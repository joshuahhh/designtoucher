import { EdgeProps, getBezierPath, useInternalNode } from "@xyflow/react";

const BAR_COLOR = "#888";
const BAR_OPACITY = 0.3;
// Darker than the bar so the connector reads on top of it
const EDGE_COLOR_DARK = "#444";
const EDGE_OPACITY_DARK = 0.6;
// Inset from node edges (to clear their rounded corners). Also used by
// proximity detection: the inset intersection must be non-empty.
export const BAR_PADDING = 4;
// How far the bar extends past the connector endpoints along its length
const BAR_END_PADDING = 16;
// Radius of the concave "surface tension" fillets where the bar meets the
// node outlines. Automatically shrinks for short/thin bars.
const BAR_FILLET = 10;

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
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) return null;

  const orientation = data?.orientation as "vertical" | "horizontal";

  // Fade in on mount (CSS animation). No exit animation: an exiting edge
  // would keep tracking live node positions into geometries the proximity
  // rules no longer guarantee are valid.
  const groupProps = { className: "proximity-edge-fade" };

  const sw = sourceNode.measured.width ?? 160;
  const sh = sourceNode.measured.height ?? 60;
  const tw = targetNode.measured.width ?? 160;
  const th = targetNode.measured.height ?? 60;

  // positionAbsolute is top-left corner of the node
  const sLeft = sourceNode.internals.positionAbsolute.x;
  const sTop = sourceNode.internals.positionAbsolute.y;
  const tLeft = targetNode.internals.positionAbsolute.x;
  const tTop = targetNode.internals.positionAbsolute.y;

  if (orientation === "vertical") {
    // Bar fills the vertical gap between the two nodes
    const barTop = sTop + sh;
    const barBottom = tTop;

    // Bar spans just the connector endpoints (plus padding), but never
    // beyond the horizontal extent of either node (inset a bit for their
    // rounded corners).
    const overlapLeft = Math.max(sLeft, tLeft) + BAR_PADDING;
    const overlapRight = Math.min(sLeft + sw, tLeft + tw) - BAR_PADDING;

    const wantedLeft = Math.min(sourceX, targetX) - BAR_END_PADDING;
    const wantedRight = Math.max(sourceX, targetX) + BAR_END_PADDING;

    let barX1 = Math.max(overlapLeft, wantedLeft);
    let barX2 = Math.min(overlapRight, wantedRight);
    if (barX2 < barX1) {
      // The wanted span lies entirely outside the inset overlap — slide it
      // to the nearest end of the overlap instead of going negative.
      const w = Math.min(wantedRight - wantedLeft, overlapRight - overlapLeft);
      if (wantedRight < overlapLeft) {
        barX1 = overlapLeft;
        barX2 = overlapLeft + w;
      } else {
        barX2 = overlapRight;
        barX1 = overlapRight - w;
      }
    }

    // Normal bezier connector (same shape as regular edges), drawn on top of
    // the bar in a darker color so it stays visible.
    const [pathD] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });

    // Meniscus-shaped bar: full-width contact along both node faces, flat
    // ends inset by the fillet, concave fillets flaring back out to the
    // faces. The flare along the bar clamps to a quarter of its length (so
    // at least half the bar always remains) and the fillet depth clamps to
    // half the gap, keeping short bars proportional instead of pinched.
    const fx = Math.max(0, Math.min(BAR_FILLET, (barX2 - barX1) / 4));
    const fy = Math.max(0, Math.min(BAR_FILLET, (barBottom - barTop) / 2));
    const barPathD = [
      `M ${barX1} ${barTop}`,
      `L ${barX2} ${barTop}`,
      `Q ${barX2 - fx} ${barTop} ${barX2 - fx} ${barTop + fy}`,
      `L ${barX2 - fx} ${barBottom - fy}`,
      `Q ${barX2 - fx} ${barBottom} ${barX2} ${barBottom}`,
      `L ${barX1} ${barBottom}`,
      `Q ${barX1 + fx} ${barBottom} ${barX1 + fx} ${barBottom - fy}`,
      `L ${barX1 + fx} ${barTop + fy}`,
      `Q ${barX1 + fx} ${barTop} ${barX1} ${barTop}`,
      `Z`,
    ].join(" ");

    return (
      <g {...groupProps}>
        <path d={barPathD} fill={BAR_COLOR} opacity={BAR_OPACITY} />
        <path
          d={pathD}
          fill="none"
          stroke={EDGE_COLOR_DARK}
          strokeWidth={1}
          opacity={EDGE_OPACITY_DARK}
        />
      </g>
    );
  } else {
    // Bar fills the horizontal gap between the two nodes
    const barLeft = sLeft + sw;
    const barRight = tLeft;
    const barMidX = (barLeft + barRight) / 2;

    // Bar is the intersection of the two nodes' vertical extents, inset a
    // bit for their rounded corners — as tall as possible within that.
    const barY1 = Math.max(sTop, tTop) + BAR_PADDING;
    const barY2 = Math.min(sTop + sh, tTop + th) - BAR_PADDING;

    // Connector, dark so it reads on top of the bar. Route: sweep below the
    // source node, climb the gap column (through the bar), sweep above the
    // target node — the sweeps stay in clear space so the wire never crosses
    // a node body. Each sweep is one cubic whose easing extends past the
    // node edge into the climb, and turn size adapts to the horizontal
    // distance covered, so the straight section is short and the whole wire
    // reads as a continuous swoop.
    const clamp = (v: number, lo: number, hi: number) =>
      Math.min(Math.max(v, lo), hi);
    const rBottom = clamp(Math.abs(barMidX - sourceX) * 0.3, 24, 60);
    const rTop = clamp(Math.abs(targetX - barMidX) * 0.3, 24, 60);

    let yJoinBottom = sourceY - rBottom;
    let yJoinTop = targetY + rTop;
    if (yJoinBottom < yJoinTop) {
      // Joins would cross (nodes nearly aligned) — meet in the middle.
      yJoinBottom = yJoinTop = (yJoinBottom + yJoinTop) / 2;
    }

    const pathD = [
      // Out of the output heading down, sweeping across below the source
      // node and easing up into the gap column.
      `M ${sourceX} ${sourceY}`,
      `C ${sourceX} ${sourceY + rBottom}, ${barMidX} ${sourceY + rBottom}, ${barMidX} ${yJoinBottom}`,
      // Climb the gap column (vertical tangents at both joins, no kinks).
      `L ${barMidX} ${yJoinTop}`,
      // Ease out of the column, sweeping above the target node and down
      // into its input.
      `C ${barMidX} ${targetY - rTop}, ${targetX} ${targetY - rTop}, ${targetX} ${targetY}`,
    ].join(" ");

    // Meniscus-shaped bar: full-height contact along both node faces, flat
    // ends inset by the fillet, concave fillets flaring back out to the
    // faces. The flare along the bar clamps to a quarter of its length (so
    // at least half the bar always remains) and the fillet depth clamps to
    // half the gap, keeping short bars proportional instead of pinched.
    const fy = Math.max(0, Math.min(BAR_FILLET, (barY2 - barY1) / 4));
    const fx = Math.max(0, Math.min(BAR_FILLET, (barRight - barLeft) / 2));
    const barPathD = [
      `M ${barLeft} ${barY1}`,
      `Q ${barLeft} ${barY1 + fy} ${barLeft + fx} ${barY1 + fy}`,
      `L ${barRight - fx} ${barY1 + fy}`,
      `Q ${barRight} ${barY1 + fy} ${barRight} ${barY1}`,
      `L ${barRight} ${barY2}`,
      `Q ${barRight} ${barY2 - fy} ${barRight - fx} ${barY2 - fy}`,
      `L ${barLeft + fx} ${barY2 - fy}`,
      `Q ${barLeft} ${barY2 - fy} ${barLeft} ${barY2}`,
      `Z`,
    ].join(" ");

    return (
      <g {...groupProps}>
        <path d={barPathD} fill={BAR_COLOR} opacity={BAR_OPACITY} />
        <path
          d={pathD}
          fill="none"
          stroke={EDGE_COLOR_DARK}
          strokeWidth={1}
          opacity={EDGE_OPACITY_DARK}
        />
      </g>
    );
  }
}
