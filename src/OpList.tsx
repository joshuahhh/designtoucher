import { clsx } from "clsx";
import { memo, ReactNode, useState } from "react";
import { FaLightbulb } from "react-icons/fa";
import { up } from "update-proxy";
import { HighlightMatches } from "./HighlightMatches.js";
import {
  AnyOp,
  AnyOpId,
  getOpId,
  InputHandle as InputHandleType,
  OutputHandle as OutputHandleType,
} from "./ops-core.js";
import { ops } from "./ops/all-the-ops.js";

/** Pre-computed default params for every op, shared across all OpList instances. */
const paramsByOp = Object.fromEntries(
  ops.map((op) => [op.id, op.initParams?.() ?? {}]),
);

const noopParamsUP = up<Record<string, unknown>>(() => {});

/**
 * Shared searchable, grouped op list used by both the picker node and the sidebar.
 */
export const OpList = memo(function OpList({
  opsInGroups,
  searchQuery,
  renderOpWrapper,
  InputHandle,
  OutputHandle,
  groupClassName,
  groupHeadingClassName,
  gapClassName,
}: {
  opsInGroups: [string, AnyOp[]][];
  searchQuery: string;
  /** Wraps each op's preview. Receives the op id and the rendered preview as children. */
  renderOpWrapper: (opId: AnyOpId, children: ReactNode) => ReactNode;
  InputHandle: typeof InputHandleType<string>;
  OutputHandle: typeof OutputHandleType<string>;
  groupClassName?: string;
  groupHeadingClassName?: string;
  gapClassName?: string;
}) {
  const [opHasMatch, setOpHasMatch] = useState<Record<string, boolean>>({});

  return (
    <>
      {opsInGroups.map(([groupName, groupOps]) => (
        <div
          key={groupName}
          className={clsx(groupClassName, {
            hidden: searchQuery && !groupOps.some((op) => opHasMatch[op.id]),
          })}
        >
          <h4 className={groupHeadingClassName}>{groupName}</h4>
          <div className={clsx("flex flex-col", gapClassName)}>
            {groupOps.map((op) => (
              <HighlightMatches
                key={op.id}
                query={searchQuery}
                setHasMatches={(hasMatches) => {
                  if (opHasMatch[op.id] === hasMatches) return;
                  setOpHasMatch((prev) => ({
                    ...prev,
                    [op.id]: hasMatches,
                  }));
                }}
                className={clsx("shrink-0", {
                  hidden: searchQuery && !opHasMatch[op.id],
                })}
              >
                {renderOpWrapper(
                  getOpId(op),
                  <op.Render
                    runtime={null}
                    paramsUP={noopParamsUP}
                    params={paramsByOp[op.id]}
                    InputHandle={InputHandle}
                    OutputHandle={OutputHandle}
                  />,
                )}
                {(op.searchHints ?? []).map((hint, i) => (
                  <div
                    key={i}
                    className={clsx(
                      {
                        "!hidden":
                          !searchQuery ||
                          !hint.toLowerCase().includes(searchQuery),
                      },
                      "text-xs text-gray-500 mt-1 ml-3 flex gap-2",
                    )}
                  >
                    <FaLightbulb className="inline-block shrink-0" /> {hint}
                  </div>
                ))}
              </HighlightMatches>
            ))}
          </div>
        </div>
      ))}
    </>
  );
});
