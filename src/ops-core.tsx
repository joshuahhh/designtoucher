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
import React, {
  Component,
  createContext,
  ForwardedRef,
  forwardRef,
  memo,
  ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { LuPanelRight, LuPanelRightClose } from "react-icons/lu";
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
    notify: () => void;
  }) => void;
  runLate?: (props: {
    runtime: Runtime;
    inputs: Record<InputKey, Tex | null>;
    params: Params;
    ctx: OmniCanvasContextType;
    notify: () => void;
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

function OpRenderInner({
  opRender,
  ...rest
}: {
  opRender: (...args: any[]) => React.ReactNode;
  [key: string]: any;
}) {
  return opRender({ InputHandle, OutputHandle, ...rest });
}

class OpErrorBoundary extends Component<
  { opId: string; children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="text-[10px] p-1 text-red-400">
          <div className="font-bold">{this.props.opId}: error</div>
          <div className="text-gray-400 truncate">
            {this.state.error.message}
          </div>
          <button
            className="mt-1 text-blue-400 hover:text-blue-300 underline"
            onClick={() => this.setState({ error: null })}
          >
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
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
      return (
        <OpErrorBoundary opId={op.id}>
          <OpRenderInner
            opRender={op.Render}
            runtime={instance.runtime}
            {...props}
          />
        </OpErrorBoundary>
      );
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
    op.run?.({ ...props, runtime: this.runtime, notify: this.notify });
    this._notifyIfRuntimeChanged(before);
  }
  runLate(props: OpInstanceMethodProps<Runtime, InputKey, Params, "runLate">) {
    const before = { ...this.runtime };
    const op = this.getOp();
    op.runLate?.({ ...props, runtime: this.runtime, notify: this.notify });
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
  "runtime" | "notify"
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
  // react-flow wants events on handles to be directly on the
  // handle, not on children, so I guess this makes that work?
  "[&>*]:pointer-events-none",
);

export const InputHandle = <InputKey extends string>({
  inputKey,
  position: positionProp,
}: {
  inputKey: InputKey;
  position?: Position;
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
      position={positionProp ?? Position.Top}
      id={handleId}
      className={className}
    >
      {sourceOutput ? (
        <>
          <Monitor
            tex={sourceOutput}
            className="pointer-events-none -mx-[0.5px]"
            cornerRadiusPixels={200}
            sizing="height"
          />
          {edgeCount > 1 && (
            <div className="absolute -top-1.5 -right-1.5 bg-orange-500 text-white text-[8px] leading-none rounded-full w-3 h-3 flex items-center justify-center">
              {edgeCount}
            </div>
          )}
        </>
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

// Reserves a fixed width for the widest string the field can ever show
// (passed as `widest`), so the number never shifts as digits/sign change —
// whether it's driven by dragging the number, the slider, or an on-canvas
// gizmo. The widest string sits in the layout (invisible) while the actual
// content is overlaid, centered, on top.
const StableWidthSpan = forwardRef<
  HTMLSpanElement,
  {
    widest?: string;
  } & React.HTMLAttributes<HTMLSpanElement>
>(({ widest, children, style, ...otherProps }, forwardedRef) => {
  return (
    <span
      ref={forwardedRef}
      {...otherProps}
      style={{ ...style, display: "inline-block", position: "relative" }}
    >
      <span aria-hidden style={{ visibility: "hidden" }}>
        {widest ?? children}
      </span>
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        {children}
      </span>
    </span>
  );
});

// Number of decimal places implied by a step, e.g. 0.001 -> 3, 1 -> 0,
// 1e-7 -> 7. Used to render param values with a fixed number of decimals.
function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  const eMatch = s.match(/e-(\d+)$/i);
  if (eMatch) return parseInt(eMatch[1], 10);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

// Display a param value with a fixed number of decimals (so its width stays
// stable during drags and float artifacts like 0.70100000000001 never show).
// Strips a stray leading "-" from negative-zero results like "-0.000".
function formatParamValue(value: number, step: number): string {
  return value.toFixed(decimalsForStep(step)).replace(/^-(?=0(\.0+)?$)/, "");
}

// The widest string the field can show across [min, max] at this step: the
// most integer digits either endpoint needs, a sign slot if values can go
// negative, and the fixed decimals. Used to reserve a stable width.
function widestParamValue(min: number, max: number, step: number): string {
  const decimals = decimalsForStep(step);
  const intDigits = (v: number) => {
    const s = Math.abs(v).toFixed(decimals);
    const dot = s.indexOf(".");
    return dot === -1 ? s.length : dot;
  };
  const digits = Math.max(intDigits(min), intDigits(max));
  return (
    (min < 0 ? "-" : "") +
    "0".repeat(digits) +
    (decimals > 0 ? "." + "0".repeat(decimals) : "")
  );
}

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

  const takeSnapshot = useContext(TakeSnapshotContext);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverDisabled, setPopoverDisabled] = useState(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.stopPropagation();
      takeSnapshot();
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
    [max, min, step, value, valueUP, takeSnapshot],
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
          widest={widestParamValue(min, max, step)}
          className={clsx(
            "tabular-nums cursor-ew-resize select-none rounded px-1 font-semibold transition-colors",
            "text-center",
            dragging
              ? "bg-blue-500 text-white ring-1 ring-blue-600"
              : "bg-blue-100 text-blue-700 hover:bg-blue-200",
          )}
          onPointerDown={onPointerDown}
          onDoubleClick={() => {
            takeSnapshot();
            valueUP.$set(0);
          }}
        >
          {formatParamValue(value, step)}
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
                if (!dragging) takeSnapshot();
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
export const SentenceParamSelect = <T extends string | number>({
  value,
  valueUP,
  options,
}: {
  value: T | null;
  valueUP: UpdateProxy<T>;
  options: (T | { value: T; label: string })[];
}) => {
  const takeSnapshot = useContext(TakeSnapshotContext);
  const coerce =
    typeof value === "number"
      ? (v: string) => Number(v) as T
      : (v: string) => v as T;
  return (
    <select
      value={value ?? ""}
      className="text-xs font-['Varela_Round'] bg-transparent border-b border"
      onChange={(e) => {
        takeSnapshot();
        valueUP.$set(coerce(e.target.value));
      }}
    >
      {options.map((option) => {
        const { value, label } =
          typeof option === "object" && option !== null
            ? option
            : { value: option, label: String(option) };
        return (
          <option key={value} value={value}>
            {label}
          </option>
        );
      })}
    </select>
  );
};

export const SentenceParamColor = ({
  r,
  g,
  b,
  rUP,
  gUP,
  bUP,
}: {
  r: number;
  g: number;
  b: number;
  rUP: UpdateProxy<number>;
  gUP: UpdateProxy<number>;
  bUP: UpdateProxy<number>;
}) => {
  const takeSnapshot = useContext(TakeSnapshotContext);

  const toHex = (n: number) =>
    Math.round(Math.max(0, Math.min(1, n)) * 255)
      .toString(16)
      .padStart(2, "0");
  const hexValue = `#${toHex(r)}${toHex(g)}${toHex(b)}`;

  return (
    <span className="relative inline-block h-5 w-8 align-middle">
      <span
        className="absolute inset-0 rounded-md border border-gray-300 shadow-sm"
        style={{ backgroundColor: hexValue }}
      />
      <input
        type="color"
        value={hexValue}
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(e) => {
          takeSnapshot();
          const hex = e.target.value;
          rUP.$set(parseInt(hex.slice(1, 3), 16) / 255);
          gUP.$set(parseInt(hex.slice(3, 5), 16) / 255);
          bUP.$set(parseInt(hex.slice(5, 7), 16) / 255);
        }}
      />
    </span>
  );
};

// A preview shows a single op *output* (a node can have several, e.g. the
// selfie op), so we target by node id + output key rather than by node.
export type PreviewTarget = { nodeId: string; outputKey: string };
export type PreviewMode = "split" | "full";
export type PreviewFit = "cover" | "contain";

export type PreviewApi = {
  target: PreviewTarget | null;
  mode: PreviewMode;
  fit: PreviewFit;
  /** Open the given output in split mode (the entry point; `f` then toggles full). */
  open: (target: PreviewTarget) => void;
  setMode: (mode: PreviewMode) => void;
  setFit: (fit: PreviewFit) => void;
  close: () => void;
};

export const PreviewContext = createContext<PreviewApi>({
  target: null,
  mode: "split",
  fit: "cover",
  open: () => {},
  setMode: () => {},
  setFit: () => {},
  close: () => {},
});

/** Resolve the live texture for a preview target, re-rendering as it updates. */
export function usePreviewTex(target: PreviewTarget | null): Tex | null {
  const opInstances = useContext(OpInstancesContext);
  const instance = target ? (opInstances[target.nodeId] ?? null) : null;
  const subscribe = useCallback(
    (cb: () => void) => instance?.subscribe(cb) ?? (() => {}),
    [instance],
  );
  useSyncExternalStore(subscribe, () => instance?.getRevision() ?? 0);
  return instance && target
    ? ((instance.runtime[target.outputKey] as Tex | null) ?? null)
    : null;
}

/** Resolve the live texture feeding a given input key on the current node. */
export function useInputTex(inputKey: string): Tex | null {
  const nodeId = useNodeId()!;
  const handleId = makeInputHandleId(nodeId, inputKey);
  const edges = useEdges();
  const edge = edges.find((e) => e.targetHandle === handleId) ?? null;
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

  return sourceInstance
    ? (sourceInstance.runtime[sourceHandleParsed!.key] as Tex | null)
    : null;
}

export const TakeSnapshotContext = createContext<() => void>(() => {});

export const OutputHandle = <OutputKey extends string>({
  outputKey,
  size,
  position: positionProp,
  children,
  showPreview = true,
}: {
  outputKey: OutputKey;
  size?: number;
  position?: Position;
  children?: ReactNode;
  showPreview?: boolean;
}) => {
  const nodeId = useNodeId();

  const preview = useContext(PreviewContext);
  const isActive =
    preview.target?.nodeId === nodeId &&
    preview.target?.outputKey === outputKey;

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
        position={positionProp ?? Position.Bottom}
        // TODO: customize
        id={makeOutputHandleId(nodeId, outputKey)}
        className={clsx(
          sharedHandleClasses,
          "border-4 relative transition-all",
          isActive
            ? "border-blue-500 ring-2 ring-blue-400"
            : "border-black hover:border-blue-300",
          { "border-dashed": !output },
        )}
        style={{
          width: 200 * (size ?? 1),
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {showPreview ? (
          output ? (
            <div className="-m-[1px]">
              <Monitor tex={output} cornerRadiusPixels={20} />
            </div>
          ) : (
            <div
              style={{
                aspectRatio: "1.77778 / 1",
              }}
            />
          )
        ) : (
          <div style={{ height: 8 }} />
        )}
        {output && (isHovered || isActive || children) && (
          <OmniCanvasOverlay className="absolute left-0 top-0 w-full h-full pointer-events-none">
            {(isHovered || isActive) && (
              <button
                onClick={() =>
                  isActive
                    ? preview.close()
                    : preview.open({ nodeId, outputKey })
                }
                className={clsx(
                  "absolute top-1 right-1 p-1 rounded transition-colors pointer-events-auto z-10",
                  isActive
                    ? "bg-blue-500 text-white hover:bg-blue-600"
                    : "bg-black/70 text-white hover:bg-black/90",
                )}
                title={isActive ? "Close preview" : "Preview (split-screen)"}
              >
                {isActive ? <LuPanelRightClose /> : <LuPanelRight />}
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
