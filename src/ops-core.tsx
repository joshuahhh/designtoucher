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
import {
  createContext,
  createRef,
  Dispatch,
  ForwardedRef,
  forwardRef,
  memo,
  ReactNode,
  SetStateAction,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { FaExpandArrowsAlt } from "react-icons/fa";
import { mergeRefs } from "react-merge-refs";
import { UpdateProxy } from "update-proxy";
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
  initRuntime?: (ctx: OmniCanvasContextType, notify: () => void) => Runtime;
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
  outputKeys?: string[];
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

export class OpInstance<
  Runtime extends Record<string, unknown>,
  InputKey extends string,
  Params extends Record<string, unknown>,
> {
  public runtime: Runtime;

  private _revision = 0;
  private _listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  getRevision = () => this._revision;

  notify = () => {
    this._revision++;
    for (const listener of this._listeners) {
      listener();
    }
  };

  Render: (
    props: Omit<
      OpInstanceMethodProps<Runtime, InputKey, Params, "Render">,
      "InputHandle" | "OutputHandle"
    >,
  ) => React.ReactNode;

  constructor(
    public getOp: () => Op<Runtime, InputKey, Params>,
    ctx: OmniCanvasContextType,
  ) {
    const op = this.getOp();
    this.runtime = op.initRuntime?.(ctx, this.notify) ?? ({} as Runtime);

    const instance = this;
    this.Render = memo(function OpInstanceRender(
      props: Omit<
        OpInstanceMethodProps<Runtime, InputKey, Params, "Render">,
        "InputHandle" | "OutputHandle"
      >,
    ) {
      useSyncExternalStore(instance.subscribe, instance.getRevision);
      const op = instance.getOp();
      return op.Render({
        runtime: instance.runtime,
        InputHandle,
        OutputHandle,
        ...props,
      });
    });
  }

  private _notifyIfRuntimeChanged(before: Record<string, unknown>) {
    for (const key of Object.keys(this.runtime)) {
      if (this.runtime[key] !== before[key]) {
        this.notify();
        return;
      }
    }
  }

  run(props: OpInstanceMethodProps<Runtime, InputKey, Params, "run">) {
    const before = { ...this.runtime };
    const op = this.getOp();
    op.run?.({ runtime: this.runtime, ...props });
    this._notifyIfRuntimeChanged(before);
  }
  runLate(props: OpInstanceMethodProps<Runtime, InputKey, Params, "runLate">) {
    const before = { ...this.runtime };
    const op = this.getOp();
    op.runLate?.({ runtime: this.runtime, ...props });
    this._notifyIfRuntimeChanged(before);
  }
  destroy(props: OpInstanceMethodProps<Runtime, InputKey, Params, "destroy">) {
    const op = this.getOp();
    return op.destroy?.({ runtime: this.runtime, ...props });
  }
}

type OpInstanceMethodProps<
  Runtime extends Record<string, unknown>,
  InputKey extends string,
  Params extends Record<string, unknown>,
  MethodName extends "run" | "runLate" | "destroy" | "Render",
> = Omit<
  Parameters<NonNullable<Op<Runtime, InputKey, Params>[MethodName]>>[0],
  "runtime"
>;

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

export const OpInstancesContext = createContext<Record<string, AnyOpInstance>>(
  {},
);

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

  // figure out if we're downstream of a node (possibly multiple)
  const edges = useEdges();
  const matchingEdges = edges.filter((e) => e.targetHandle === handleId);
  const edgeCount = matchingEdges.length;
  const edge = matchingEdges[0] ?? null;
  const opInstances = useContext(OpInstancesContext);

  const sourceHandleParsed = edge && parseOutputHandleId(edge.sourceHandle!);
  const sourceInstance =
    opInstances && sourceHandleParsed
      ? opInstances[sourceHandleParsed.nodeId]
      : null;
  const subscribe = useCallback(
    (cb: () => void) => sourceInstance?.subscribe(cb) ?? (() => {}),
    [sourceInstance],
  );
  useSyncExternalStore(subscribe, () => sourceInstance?.getRevision() ?? 0);
  const sourceOutput = sourceInstance
    ? (sourceInstance.runtime[sourceHandleParsed!.key] as Tex | null)
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
        <div className="-m-[1px] relative">
          <Monitor
            tex={sourceOutput}
            className="pointer-events-none"
            cornerRadiusPixels={200}
          />
          {edgeCount > 1 && (
            <div className="absolute -top-1.5 -right-1.5 bg-orange-500 text-white text-[8px] leading-none rounded-full w-3 h-3 flex items-center justify-center">
              {edgeCount}
            </div>
          )}
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
          <div className="w-32">
            <Slider
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
          </div>
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

// TODO: this generic doesn't seem to work to constrain "options"
export const SentenceParamSelect = <T extends string>({
  value,
  valueUP,
  options,
}: {
  value: T | null;
  valueUP: UpdateProxy<T>;
  options: (T | { value: T; label: string })[];
}) => {
  return (
    <select
      value={value ?? ""}
      className="text-xs font-['Varela_Round'] bg-transparent border-b border"
      onChange={(e) => {
        valueUP.$set(e.target.value as T);
      }}
    >
      {options.map((option) => {
        const { value, label } =
          typeof option === "string"
            ? { value: option, label: option }
            : option;
        return (
          <option key={value} value={value}>
            {label}
          </option>
        );
      })}
    </select>
  );
};

export const SetFullscreenModalTexContext = createContext<
  Dispatch<SetStateAction<Tex | null>>
>(null as any);

export const OutputHandle = <OutputKey extends string>({
  outputKey,
  size,
  children,
}: {
  outputKey: OutputKey;
  size?: number;
  children?: ReactNode;
}) => {
  const nodeId = useNodeId();

  const setFullscreenModalTex = useContext(SetFullscreenModalTexContext);

  const [isHovered, setIsHovered] = useState(false);

  const opInstances = useContext(OpInstancesContext);

  const instance = nodeId !== null ? opInstances[nodeId] : null;
  const subscribe = useCallback(
    (cb: () => void) => instance?.subscribe(cb) ?? (() => {}),
    [instance],
  );
  useSyncExternalStore(subscribe, () => instance?.getRevision() ?? 0);

  const output = instance
    ? (instance.runtime[outputKey] as Tex | null)
    : undefined;

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
          "border-4 border-black hover:border-blue-300 relative",
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
        {output && (isHovered || children) && (
          <OmniCanvasOverlay className="absolute left-0 top-0 w-full h-full pointer-events-none">
            {isHovered && (
              <button
                onClick={() => setFullscreenModalTex(output)}
                className="absolute top-1 right-1 bg-black/70 text-white p-1 rounded hover:bg-black/90 transition-colors pointer-events-auto z-10"
                title="View fullscreen"
              >
                <FaExpandArrowsAlt />
              </button>
            )}
            {children}
          </OmniCanvasOverlay>
        )}
      </Handle>
    </>
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
