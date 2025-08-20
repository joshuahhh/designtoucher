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
  ForwardedRef,
  forwardRef,
  ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FaExpandArrowsAlt } from "react-icons/fa";
import { mergeRefs } from "react-merge-refs";
import { UpdateProxy } from "update-proxy";
import { useKeyBindings } from "./keyboard.js";
import { Tex } from "./mygl.js";
import {
  Monitor,
  OmniCanvasContext,
  OmniCanvasContextType,
  OmniCanvasOverlay,
} from "./OmniCanvas.js";

export type Op<
  Runtime extends Record<string, unknown>,
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
  Render: (props: {
    runtime: Runtime | null;
    params: Params;
    paramsUP: UpdateProxy<Params>;
    InputHandle: typeof InputHandle<InputKey>;
    OutputHandle: typeof OutputHandle<OutputKey<Runtime>>;
  }) => React.ReactNode;
  searchHints?: string[];
};
export type AnyOp = Op<
  Record<string, unknown>,
  string,
  Record<string, unknown>
>;
export function anyOp<
  Runtime extends Record<string, unknown>,
  InputKey extends string,
  Params extends Record<string, unknown>,
>(op: Op<Runtime, InputKey, Params>): AnyOp {
  return op as any;
}

export type OutputKey<Runtime extends Record<string, unknown>> = {
  [K in keyof Runtime]: Runtime[K] extends Tex | null ? K : never;
}[keyof Runtime] &
  string;

export function defineOp<
  Runtime extends Record<string, unknown>,
  InputKey extends string,
  Params extends Record<string, unknown>,
>(op: Op<Runtime, InputKey, Params>) {
  return op;
}

export type OpId<
  Runtime extends Record<string, unknown>,
  InputKey extends string,
  Params extends Record<string, unknown>,
> = string & {
  __op: Op<Runtime, InputKey, Params>;
};
export type AnyOpId = OpId<
  Record<string, unknown>,
  string,
  Record<string, unknown>
>;
export function anyOpId<
  Runtime extends Record<string, unknown>,
  InputKey extends string,
  Params extends Record<string, unknown>,
>(opId: OpId<Runtime, InputKey, Params>): AnyOpId {
  return opId as any;
}

export function getOpId<
  Runtime extends Record<string, unknown>,
  InputKey extends string,
  Params extends Record<string, unknown>,
>(op: Op<Runtime, InputKey, Params>): OpId<Runtime, InputKey, Params> {
  return op.id as OpId<Runtime, InputKey, Params>;
}

export type OpInstance<
  Runtime extends Record<string, unknown>,
  InputKey extends string,
  Params extends Record<string, unknown>,
> = {
  runtime: Runtime;
  getOp: () => Op<Runtime, InputKey, Params>;
};
export type AnyOpInstance = OpInstance<
  Record<string, unknown>,
  string,
  Record<string, unknown>
>;
export function anyOpInstance<
  Runtime extends Record<string, unknown>,
  InputKey extends string,
  Params extends Record<string, unknown>,
>(opInstance: OpInstance<Runtime, InputKey, Params>): AnyOpInstance {
  return opInstance as any;
}

export type OpInstanceOf<O> =
  O extends Op<infer Runtime, infer InputKey, infer Params>
    ? OpInstance<Runtime, InputKey, Params>
    : never;

export const FlowContext = createContext<{
  opInstances: Record<string, AnyOpInstance>;
}>({ opInstances: {} });

export const Render = ({
  op,
  ...props
}: { op: AnyOp } & Omit<
  Parameters<AnyOp["Render"]>[0],
  "InputHandle" | "OutputHandle"
>) => {
  return (
    <op.Render
      InputHandle={InputHandle}
      OutputHandle={OutputHandle}
      {...props}
    />
  );
};

export const Sentence = ({ children }: { children: ReactNode }) => {
  return <div className="text-xs font-['Varela_Round']">{children}</div>;
};

export const sharedHandleClasses = clsx(
  "nodrag rounded-sm transition-all duration-100",
  // React Flow's built-in handle selection styling
  "[&.clickconnecting]:border-blue-400",
  "[&.clickconnecting]:shadow-lg",
  "[&.clickconnecting]:shadow-blue-200/20",
  "[&.clickconnecting]:ring-1",
  "[&.clickconnecting]:ring-blue-300/15",
  "pointer-events-auto",
  "[&.connectionindicator]:cursor-crosshair",
  // react-flow wants events on handles to be directly on the
  // handle, not on children, so I guess this makes that work?
  "[&>*]:pointer-events-none",
);

export const InputHandle = <InputKey extends string>({
  inputKey,
}: {
  inputKey: InputKey;
}) => {
  const nodeId = useNodeId()!;
  const handleId = makeInputHandleId(nodeId, inputKey);

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

  const className = clsx(
    sharedHandleClasses,
    "inline-flex border-2 border-solid border-black hover:border-blue-300",
    {
      "w-4 h-4 align-text-bottom": !sourceOutput,
      "h-4 align-text-bottom": sourceOutput,
    },
  );

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
        <div className="-m-[1px]">
          <Monitor
            tex={sourceOutput}
            className="pointer-events-none"
            cornerRadiusPixels={200}
          />
        </div>
      ) : null}
    </Handle>
  );
};

export const SentenceButton = forwardRef(
  (
    props: React.ButtonHTMLAttributes<HTMLButtonElement>,
    ref: ForwardedRef<HTMLButtonElement>,
  ) => {
    return (
      <button
        ref={ref}
        {...props}
        className={clsx(
          "border border-gray-300 rounded-md p-1 shadow-sm hover:bg-gray-50 transition-colors inline-flex items-center",
          props.className,
        )}
      />
    );
  },
);

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
      const startValue = value;
      const startX = e.clientX;
      const onPointerMove = (e: PointerEvent) => {
        moved = true;
        const pixels = e.clientX - startX;
        const changePerPixel = (max - min) / 400;
        const newValue = Math.min(
          max,
          Math.max(
            min,
            startValue + Math.round((pixels * changePerPixel) / step) * step,
          ),
        );
        valueUP.$set(+newValue.toFixed(4)); // kill floating-point nonsense
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
    [max, min, step, value, valueUP],
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

export const OutputHandle = <OutputKey extends string>({
  outputKey,
  size,
}: {
  outputKey: OutputKey;
  size?: number;
}) => {
  const nodeId = useNodeId();

  const [isHovered, setIsHovered] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleFullscreenClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFullscreen(true);
    setIsHovered(false);
  }, []);

  const { opInstances } = useContext(FlowContext);
  const runtime = nodeId !== null ? opInstances[nodeId]?.runtime : undefined;
  const output = runtime?.[outputKey] as Tex | null;

  if (!nodeId) {
    return null;
  }

  return (
    <>
      <Handle
        type="source"
        position={Position.Bottom}
        // TODO: customize
        id={makeOutputHandleId(nodeId, outputKey)}
        className={clsx(
          sharedHandleClasses,
          "border-4 border-black hover:border-blue-300",
          { "border-dashed": !output },
        )}
        style={{
          width: 200 * (size ?? 1),
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {output ? (
          <div className="-m-[1px]">
            <Monitor tex={output} cornerRadiusPixels={20} />
          </div>
        ) : (
          <div
            style={{
              aspectRatio: "1.77778 / 1",
            }}
          />
        )}
        {output && isHovered && !isFullscreen && (
          <OmniCanvasOverlay className="absolute left-0 top-0 w-full h-full pointer-events-none">
            <button
              onClick={handleFullscreenClick}
              className="absolute top-1 right-1 bg-black/70 text-white p-1 rounded hover:bg-black/90 transition-colors pointer-events-auto z-10"
              title="View fullscreen"
            >
              <FaExpandArrowsAlt />
            </button>
          </OmniCanvasOverlay>
        )}
      </Handle>
      {isFullscreen && output && (
        <FullscreenModal
          tex={output}
          onClose={() => {
            setIsFullscreen(false);
          }}
        />
      )}
    </>
  );
};

const FullscreenModal = ({
  tex,
  onClose,
}: {
  tex: Tex;
  onClose: () => void;
}) => {
  const { underlayDiv } = useContext(OmniCanvasContext);

  useKeyBindings([
    {
      combo: "Escape",
      action: onClose,
    },
  ]);

  const aspectRatio = tex.width / tex.height;

  return createPortal(
    <div className="fixed inset-0 bg-black grid place-items-center [container-type:size]">
      <OmniCanvasOverlay className="absolute inset-0">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
          title="Press ESC to close"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </OmniCanvasOverlay>

      <div
        style={{
          width: `min(100cqw,calc(100cqh*${aspectRatio}))`,
          aspectRatio: aspectRatio,
        }}
      >
        <Monitor tex={tex} />
      </div>
    </div>,
    underlayDiv,
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
