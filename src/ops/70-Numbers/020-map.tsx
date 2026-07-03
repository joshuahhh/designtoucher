import clsx from "clsx";
import { useContext } from "react";
import { LuRotateCcw } from "react-icons/lu";
import {
  defineOp,
  NumberOutputHandle,
  Sentence,
  SentenceParamNumber,
  TakeSnapshotContext,
} from "../../ops-core.js";

// Remap a number from one range to another (linearly, unclamped — a value
// outside [a, b] maps proportionally outside [c, d]).
export default defineOp({
  id: "map",
  outputKeys: ["out"],
  outputTypes: { out: "number" },
  initParams() {
    return { in: 0, a: 0, b: 1, c: 0, d: 1 };
  },
  initRuntime() {
    return { out: 0 };
  },
  run({ runtime, params }) {
    const { in: x, a, b, c, d } = params;
    const t = b === a ? 0 : (x - a) / (b - a);
    runtime.out = c + t * (d - c);
  },
  Render(props) {
    const { params, paramsUP } = props;
    const takeSnapshot = useContext(TakeSnapshotContext);

    const rangeReset = (isDefault: boolean, reset: () => void) => (
      <button
        type="button"
        title="Reset range to 0–1"
        onClick={() => {
          takeSnapshot();
          reset();
        }}
        className={clsx(
          "nodrag inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] align-text-bottom transition-all",
          isDefault
            ? "opacity-0 pointer-events-none"
            : "border-gray-300 text-gray-500 hover:border-violet-400/50 hover:text-violet-600",
        )}
      >
        <LuRotateCcw />
      </button>
    );

    return (
      <>
        <Sentence>
          <div>
            Map{" "}
            <SentenceParamNumber
              paramKey="in"
              value={params.in}
              valueUP={paramsUP.in}
              min={-2}
              max={2}
              step={0.01}
            />
          </div>
          <div className="mt-1 grid grid-cols-[auto_1fr] items-baseline gap-x-1.5 gap-y-1">
            <span className="text-right">from</span>
            <span>
              <SentenceParamNumber
                paramKey="a"
                value={params.a}
                valueUP={paramsUP.a}
                min={-2}
                max={2}
                step={0.01}
              />
              –
              <SentenceParamNumber
                paramKey="b"
                value={params.b}
                valueUP={paramsUP.b}
                min={-2}
                max={2}
                step={0.01}
              />{" "}
              {rangeReset(params.a === 0 && params.b === 1, () =>
                paramsUP.$((p) => ({ ...p, a: 0, b: 1 })),
              )}
            </span>
            <span className="text-right">to</span>
            <span>
              <SentenceParamNumber
                paramKey="c"
                value={params.c}
                valueUP={paramsUP.c}
                min={-2}
                max={2}
                step={0.01}
              />
              –
              <SentenceParamNumber
                paramKey="d"
                value={params.d}
                valueUP={paramsUP.d}
                min={-2}
                max={2}
                step={0.01}
              />{" "}
              {rangeReset(params.c === 0 && params.d === 1, () =>
                paramsUP.$((p) => ({ ...p, c: 0, d: 1 })),
              )}
            </span>
          </div>
        </Sentence>
        <NumberOutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["remap", "range", "scale", "lerp", "interpolate", "number"],
});
