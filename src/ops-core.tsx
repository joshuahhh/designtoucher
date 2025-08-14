import { UpdateProxy } from "@engraft/update-proxy";
import { Popover, Slider } from "@radix-ui/themes";
import { Handle, Position, useEdges, useNodeId } from "@xyflow/react";
import clsx from "clsx";
import _ from "lodash";
import {
  createContext,
  createRef,
  forwardRef,
  ReactNode,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { mergeRefs } from "react-merge-refs";
import { getHandleClasses } from "./Handles.js";
import { Tex } from "./mygl.js";
import { Monitor, OmniCanvasContextType } from "./OmniCanvas.js";

export type Op<Runtime, InputKey extends string, ParamKey extends string> = {
  id: string;
  inputKeys?: InputKey[];
  inputKeysLate?: InputKey[];
  initParams?: () => Record<ParamKey, any>;
  initRuntime?: (ctx: OmniCanvasContextType) => Runtime;
  initWithRuntime?: (props: {
    ctx: OmniCanvasContextType;
    runtime: Runtime;
  }) => void;
  run?: (props: {
    runtime: Runtime;
    inputs: Record<InputKey, Tex | null>;
    paramValues: Record<ParamKey, unknown>;
    ctx: OmniCanvasContextType;
  }) => void;
  runLate?: (props: {
    runtime: Runtime;
    inputs: Record<InputKey, Tex | null>;
    paramValues: Record<ParamKey, unknown>;
    ctx: OmniCanvasContextType;
  }) => void;
  destroy?: (props: { runtime: Runtime; ctx: OmniCanvasContextType }) => void;
  RenderTop: (props: {
    runtime: Runtime | null;
    paramValues: Record<ParamKey, unknown>;
    paramValuesUP: UpdateProxy<Record<ParamKey, unknown>>;
    Handle: typeof SentenceHandle<InputKey>;
  }) => React.ReactNode;
};
export type AnyOp = Op<unknown, string, string>;

export function defineOp<
  Runtime,
  InputKey extends string,
  ParamKey extends string,
>(op: Op<Runtime, InputKey, ParamKey>) {
  return op;
}

export type OpId<
  Runtime,
  InputKey extends string,
  ParamKey extends string,
> = string & {
  __op: Op<Runtime, InputKey, ParamKey>;
};
export type AnyOpId = OpId<unknown, string, string>;

export function getOpId<
  Runtime,
  InputKey extends string,
  ParamKey extends string,
>(op: Op<Runtime, InputKey, ParamKey>): OpId<Runtime, InputKey, ParamKey> {
  return op.id as OpId<Runtime, InputKey, ParamKey>;
}

export type OpInstance<
  Runtime,
  InputKey extends string,
  ParamKey extends string,
> = {
  opId: OpId<Runtime, InputKey, ParamKey>;
  runtime: Runtime;
};
export type AnyOpInstance = OpInstance<unknown, string, string>;

export type OpInstanceOf<O> =
  O extends Op<infer Runtime, infer InputKey, infer ParamKey>
    ? OpInstance<Runtime, InputKey, ParamKey>
    : never;

export function instantiateOp<
  Runtime,
  InputKey extends string,
  ParamKey extends string,
>(
  op: Op<Runtime, InputKey, ParamKey>,
  ctx: OmniCanvasContextType,
): OpInstance<Runtime, InputKey, ParamKey> {
  const runtime = op.initRuntime ? op.initRuntime(ctx) : ({} as Runtime);
  op.initWithRuntime?.({ ctx, runtime });
  return { opId: getOpId(op), runtime };
}

export const FlowContext = createContext<{
  opInstances: Record<string, AnyOpInstance>;
}>(undefined!);

export const Sentence = ({ children }: { children: ReactNode }) => {
  return <div className="text-xs font-['Varela_Round'] ">{children}</div>;
};

export const PhonyContext = createContext<{ phony: boolean }>({
  phony: false,
});

export const SentenceHandle = <InputKey extends string>({
  handleKey,
}: {
  handleKey: InputKey;
}) => {
  const { phony } = useContext(PhonyContext);

  const nodeId = useNodeId()!;
  const handleId = makeInputHandleId(nodeId, handleKey);

  // figure out if we're downstream of a node
  const edges = useEdges();
  const edge = _.find(edges, { targetHandle: handleId });
  const flowContext = useContext(FlowContext);

  const sourceHandleParsed = edge && parseOutputHandleId(edge.sourceHandle!);
  const sourceOutput =
    flowContext && sourceHandleParsed
      ? (flowContext.opInstances[sourceHandleParsed.nodeId].runtime as any)[
          sourceHandleParsed.key
        ]
      : null;

  const className = clsx(getHandleClasses(false), {
    "w-3 h-3": !sourceOutput,
    "h-4 align-text-bottom": sourceOutput,
  });

  return phony ? (
    <div className={className} />
  ) : (
    <Handle
      type="target"
      position={Position.Top}
      id={handleId}
      className={className}
    >
      {sourceOutput ? (
        <Monitor tex={sourceOutput} className="pointer-events-none" />
      ) : null}
    </Handle>
  );
};

const StableWidthSpan = forwardRef<
  HTMLSpanElement,
  {
    dragging?: boolean;
  } & React.HTMLAttributes<HTMLSpanElement>
>(({ dragging, ...otherProps }, forwardedRef) => {
  const ref = createRef<HTMLSpanElement>();
  const [minWidth, setMinWidth] = useState(0);

  useLayoutEffect(() => {
    if (dragging && ref.current) {
      const w = ref.current.offsetWidth;
      setMinWidth((prev) => Math.max(prev, w));
    }
    if (!dragging) {
      setMinWidth(0); // release lock
    }
  }, [dragging, ref]);

  return (
    <span
      ref={mergeRefs([ref, forwardedRef])}
      {...otherProps}
      style={{
        ...otherProps.style,
        // color: dragging ? "red" : "inherit",
        display: "inline-block",
        minWidth: dragging ? minWidth : "inherit",
      }}
    />
  );
});

export const SentenceParamNumber = ({
  varName,
  paramValues,
  paramValuesUP,
  min,
  max,
  step,
}: {
  varName: string;
  paramValues: Record<string, unknown>;
  paramValuesUP: UpdateProxy<Record<string, unknown>>;
  min: number;
  max: number;
  step: number;
}) => {
  const [dragging, setDragging] = useState(false);

  const tooltip = (
    <div className="flex flex-row items-center gap-2">
      <div className="text-xs">{min}</div>
      <Slider
        className="w-32"
        value={[paramValues[varName] as number]}
        min={min}
        max={max}
        step={step}
        onValueChange={(value) => {
          paramValuesUP[varName].$set(parseFloat(value.toString()));
          setDragging(true);
        }}
        onValueCommit={() => {
          setDragging(false);
        }}
      />
      <div className="text-xs">{max}</div>
    </div>
  );
  return (
    <Popover.Root>
      <Popover.Trigger>
        <StableWidthSpan
          dragging={dragging}
          className="underline decoration-dotted tabular-nums"
        >
          {paramValues[varName] as number}
        </StableWidthSpan>
      </Popover.Trigger>
      <Popover.Content side="top" size="1">
        {tooltip}
      </Popover.Content>
    </Popover.Root>
  );
};

export const SentenceParamSelect = ({
  varName,
  paramValues,
  paramValuesUP,
  options,
}: {
  varName: string;
  paramValues: Record<string, unknown>;
  paramValuesUP: UpdateProxy<Record<string, unknown>>;
  options: { value: string; label: string }[];
}) => {
  return (
    <select
      value={paramValues[varName] as string}
      className="text-xs font-['Varela_Round'] bg-transparent border-b border"
      onChange={(e) => {
        paramValuesUP[varName].$set(e.target.value);
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

// we have a great new convention for handles!
// the handleId is nodeId:input:key or nodeId:output:key
// where key is any old thing the node wants to use
// (no using :s in the key, natch)

export function makeInputHandleId(nodeId: string, key: string): string {
  return `${nodeId}:input:${key}`;
}
export function makeOutputHandleId(nodeId: string, key: string): string {
  return `${nodeId}:output:${key}`;
}
export function parseInputHandleId(handleId: string): {
  nodeId: string;
  key: string;
} {
  const match = handleId.match(/^(.+):input:(.+)$/);
  if (!match) throw new Error(`Invalid input handleId: ${handleId}`);
  return { nodeId: match[1], key: match[2] };
}
export function parseOutputHandleId(handleId: string): {
  nodeId: string;
  key: string;
} {
  const match = handleId.match(/^(.+):output:(.+)$/);
  if (!match) throw new Error(`Invalid output handleId: ${handleId}`);
  return { nodeId: match[1], key: match[2] };
}
