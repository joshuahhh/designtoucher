import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Popover, Slider } from "@radix-ui/themes";
import {
  Handle,
  Position,
  useEdges,
  useNodeId,
  useUpdateNodeInternals,
} from "@xyflow/react";
import clsx from "clsx";
import _ from "lodash";
import {
  createContext,
  createRef,
  forwardRef,
  ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { mergeRefs } from "react-merge-refs";
import { UpdateProxy } from "update-proxy";
import { getHandleClasses } from "./Handles.js";
import { Tex } from "./mygl.js";
import {
  Monitor,
  OmniCanvasContext,
  OmniCanvasContextType,
} from "./OmniCanvas.js";

export type Op<
  Runtime,
  InputKey extends string,
  Params extends Record<string, unknown>,
> = {
  id: string;
  inputKeys?: InputKey[];
  inputKeysLate?: InputKey[];
  initParams?: () => Params;
  initRuntime?: (ctx: OmniCanvasContextType) => Runtime;
  initWithRuntime?: (props: {
    ctx: OmniCanvasContextType;
    runtime: Runtime;
  }) => void;
  run?: (props: {
    runtime: Runtime;
    inputs: Record<InputKey, Tex | null>;
    params: Params;
    ctx: OmniCanvasContextType;
  }) => void;
  runLate?: (props: {
    runtime: Runtime;
    inputs: Record<InputKey, Tex | null>;
    params: Params;
    ctx: OmniCanvasContextType;
  }) => void;
  destroy?: (props: { runtime: Runtime; ctx: OmniCanvasContextType }) => void;
  RenderTop: (props: {
    runtime: Runtime | null;
    params: Params;
    paramsUP: UpdateProxy<Params>;
    Handle: typeof SentenceHandle<InputKey>;
  }) => React.ReactNode;
  searchHints?: string[];
};
export type AnyOp = Op<unknown, string, Record<string, unknown>>;

export function defineOp<
  Runtime,
  InputKey extends string,
  Params extends Record<string, unknown>,
>(op: Op<Runtime, InputKey, Params>) {
  return op;
}

export type OpId<
  Runtime,
  InputKey extends string,
  Params extends Record<string, unknown>,
> = string & {
  __op: Op<Runtime, InputKey, Params>;
};
export type AnyOpId = OpId<unknown, string, Record<string, unknown>>;

export function getOpId<
  Runtime,
  InputKey extends string,
  Params extends Record<string, unknown>,
>(op: Op<Runtime, InputKey, Params>): OpId<Runtime, InputKey, Params> {
  return op.id as OpId<Runtime, InputKey, Params>;
}

export type OpInstance<
  Runtime,
  InputKey extends string,
  Params extends Record<string, unknown>,
> = {
  opId: OpId<Runtime, InputKey, Params>;
  runtime: Runtime;
};
export type AnyOpInstance = OpInstance<
  unknown,
  string,
  Record<string, unknown>
>;

export type OpInstanceOf<O> =
  O extends Op<infer Runtime, infer InputKey, infer Params>
    ? OpInstance<Runtime, InputKey, Params>
    : never;

export function instantiateOp<
  Runtime,
  InputKey extends string,
  Params extends Record<string, unknown>,
>(
  op: Op<Runtime, InputKey, Params>,
  ctx: OmniCanvasContextType,
): OpInstance<Runtime, InputKey, Params> {
  const runtime = op.initRuntime ? op.initRuntime(ctx) : ({} as Runtime);
  op.initWithRuntime?.({ ctx, runtime });
  return { opId: getOpId(op), runtime };
}

export const FlowContext = createContext<{
  opInstances: Record<string, AnyOpInstance>;
}>(undefined!);

// export const RenderTopContext = createContext<{
//   op: AnyOp;
// }>(undefined!);

export const RenderTop = ({
  op,
  ...props
}: { op: AnyOp } & Omit<Parameters<AnyOp["RenderTop"]>[0], "Handle">) => {
  return (
    // <RenderTopContext.Provider value={{ op }}>
    <op.RenderTop Handle={SentenceHandle} {...props} />
    // </RenderTopContext.Provider>
  );
};

export const Sentence = ({ children }: { children: ReactNode }) => {
  return <div className="text-xs font-['Varela_Round'] ">{children}</div>;
};

export const SentenceHandle = <InputKey extends string>({
  handleKey,
}: {
  handleKey: InputKey;
}) => {
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

  return !nodeId ? (
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
  value,
  valueUP,
  min,
  max,
  step,
}: {
  value: number;
  valueUP: UpdateProxy<number>;
  min: number;
  max: number;
  step: number;
}) => {
  const [dragging, setDragging] = useState(false);

  const updateNodeInternals = useUpdateNodeInternals();
  const nodeId = useNodeId();

  useLayoutEffect(() => {
    if (nodeId) {
      void dragging; // force a re-render when dragging changes
      updateNodeInternals(nodeId);
    }
  }, [dragging, nodeId, updateNodeInternals]);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverDisabled, setPopoverDisabled] = useState(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
      let moved = false;
      const onPointerMove = (e: PointerEvent) => {
        moved = true;
        const delta = e.movementX;
        valueUP.$apply(
          (value) =>
            +Math.min(max, Math.max(min, value + delta * step)).toFixed(4),
        );
      };
      document.addEventListener("pointermove", onPointerMove);
      const onPointerUp = (e: PointerEvent) => {
        setDragging(false);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointermove", onPointerMove);
        if (moved) {
          setPopoverDisabled(true);
          setTimeout(() => {
            setPopoverDisabled(false);
          }, 10);
        }
      };
      document.addEventListener("pointerup", onPointerUp, { once: true });
    },
    [max, min, step, valueUP],
  );

  return (
    <Popover.Root
      open={popoverOpen}
      onOpenChange={(open) => {
        if (!popoverDisabled) {
          setPopoverOpen(open);
        }
      }}
    >
      <Popover.Trigger>
        <StableWidthSpan
          dragging={dragging}
          className="underline decoration-dotted tabular-nums"
          onPointerDown={onPointerDown}
          onDoubleClick={() => {
            valueUP.$set(0);
          }}
        >
          {value}
        </StableWidthSpan>
      </Popover.Trigger>
      <MyPopoverContent>
        <div className="flex flex-row items-center gap-2">
          <div className="text-xs">{min}</div>
          <Slider
            className="w-32"
            value={[value]}
            min={min}
            max={max}
            step={step}
            onValueChange={(value) => {
              valueUP.$set(parseFloat(value.toString()));
              setDragging(true);
            }}
            onValueCommit={() => {
              setDragging(false);
            }}
          />
          <div className="text-xs">{max}</div>
        </div>
      </MyPopoverContent>
    </Popover.Root>
  );
};

export const MyPopoverContent = (
  props: React.ComponentProps<typeof Popover.Content>,
) => {
  const { overlayDiv } = useContext(OmniCanvasContext);
  return (
    <Popover.Content
      {...props}
      side="top"
      size="1"
      container={overlayDiv}
      className="pointer-events-auto overflow-visible"
      arrowPadding={10}
    >
      {props.children}
      <MyArrow />
    </Popover.Content>
  );
};

export const MyArrow = () => (
  <PopoverPrimitive.Arrow
    width={20}
    height={10}
    className="fill-[--color-panel-solid]"
  />
);

export const SentenceParamSelect = ({
  value,
  valueUP,
  options,
}: {
  value: string | null;
  valueUP: UpdateProxy<string>;
  options: { value: string; label: string }[];
}) => {
  return (
    <select
      value={value ?? ""}
      className="text-xs font-['Varela_Round'] bg-transparent border-b border"
      onChange={(e) => {
        valueUP.$set(e.target.value);
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
