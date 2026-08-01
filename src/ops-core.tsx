import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Inset, Popover, Slider } from "@radix-ui/themes";
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
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChromePicker } from "react-color";
import { LuPanelRight, LuPanelRightClose } from "react-icons/lu";
import { UpdateProxy } from "update-proxy";
import { isProbablyTex, Tex } from "./mygl.js";
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
  initRuntime: (ctx: OmniCanvasContextType, notify: () => void) => Runtime;
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
  /**
   * Wire type of each output, used to validate connections. Outputs default
   * to "tex"; numops declare e.g. `outputTypes: { out: "number" }`.
   */
  outputTypes?: Record<string, "tex" | "number">;
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
        <div className="text-[10px] p-1 text-red-400 max-w-[200px]">
          <div className="font-bold">{this.props.opId}: error</div>
          <div className="text-gray-400 whitespace-pre-wrap break-words">
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
  public state:
    | { tag: "ok"; runtime: Runtime }
    | { tag: "error"; error: Error };

  getRuntime(): Runtime | null {
    return this.state.tag === "ok" ? this.state.runtime : null;
  }

  /**
   * The runtime, or (if init failed) rethrows the init error. For parent ops
   * that compose sub-instances: a sub-op's failure propagates to the parent.
   */
  getRuntimeOrThrow(): Runtime {
    if (this.state.tag === "error") throw this.state.error;
    return this.state.runtime;
  }

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
    try {
      const runtime = op.initRuntime(ctx, this.notify);
      this.state = { tag: "ok", runtime };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      this.state = { tag: "error", error };
      console.error(`initRuntime failed for op "${op.id}":`, e);
    }

    const instance = this;
    this.Render = memo(function OpInstanceRender(
      props: Omit<
        OpInstanceMethodProps<Runtime, InputKey, Params, "Render">,
        "InputHandle" | "OutputHandle"
      >,
    ) {
      useSyncExternalStore(instance.subscribe, instance.getRevision);
      const op = instance.getOp();
      const { state } = instance;
      if (state.tag === "error") {
        return (
          <div className="text-[10px] p-1 text-red-400 max-w-[200px]">
            <div className="font-bold">{op.id}: init error</div>
            <div className="text-gray-400 whitespace-pre-wrap break-words">
              {state.error.message}
            </div>
          </div>
        );
      }
      return (
        <OpErrorBoundary opId={op.id}>
          <OpRenderInner
            opRender={op.Render}
            runtime={state.runtime}
            {...props}
          />
        </OpErrorBoundary>
      );
    });
  }

  private _notifyIfRuntimeChanged(before: Record<string, unknown>) {
    const { state } = this;
    if (state.tag === "error") return;
    for (const key of Object.keys(state.runtime)) {
      if (state.runtime[key] !== before[key]) {
        this.notify();
        return;
      }
    }
  }

  run(props: OpInstanceMethodProps<Runtime, InputKey, Params, "run">) {
    const { state } = this;
    if (state.tag === "error") return;
    const before = { ...state.runtime };
    const op = this.getOp();
    op.run?.({ ...props, runtime: state.runtime, notify: this.notify });
    this._notifyIfRuntimeChanged(before);
  }
  runLate(props: OpInstanceMethodProps<Runtime, InputKey, Params, "runLate">) {
    const { state } = this;
    if (state.tag === "error") return;
    const before = { ...state.runtime };
    const op = this.getOp();
    op.runLate?.({ ...props, runtime: state.runtime, notify: this.notify });
    this._notifyIfRuntimeChanged(before);
  }
  destroy(props: OpInstanceMethodProps<Runtime, InputKey, Params, "destroy">) {
    const { state } = this;
    if (state.tag === "error") return;
    const op = this.getOp();
    return op.destroy?.({ runtime: state.runtime, ...props });
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
  const rawSourceOutput =
    sourceInstance?.getRuntime()?.[sourceHandleParsed!.key] ?? null;
  const sourceOutput = isProbablyTex(rawSourceOutput) ? rawSourceOutput : null;

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
            cornerRadiusPixels={4.5}
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
// Use this for continuously-changing values (wire-driven), where a stable
// width matters more than exactness.
function formatParamValue(value: number, step: number): string {
  return value.toFixed(decimalsForStep(step)).replace(/^-(?=0(\.0+)?$)/, "");
}

// For stored constants: like formatParamValue, but a typed-in value finer
// than the step (e.g. 0.005 with step 0.01) shows exactly instead of being
// rounded away. toFixed(6) still hides float junk like 0.30000000000000004.
function formatParamValueExact(value: number, step: number): string {
  const fixed = formatParamValue(value, step);
  return Number(fixed) === +value.toFixed(6)
    ? fixed
    : String(+value.toFixed(6));
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
  paramKey,
}: {
  value: number;
  valueUP: UpdateProxy<number>;
  min: number;
  max: number;
  step: number;
  /**
   * Key of this param in the op's params object. When given, the number chip
   * doubles as a drop target: a number wire landing on it drives the param
   * (replacing the stored constant while connected).
   */
  paramKey?: string;
}) => {
  const [dragging, setDragging] = useState(false);

  const updateNodeInternals = useUpdateNodeInternals();
  const nodeId = useNodeId();

  // If a number wire is connected to this param, resolve its live value by
  // subscribing to the source op instance (same pattern as InputHandle).
  const paramHandleId =
    nodeId && paramKey ? makeParamHandleId(nodeId, paramKey) : null;
  const edges = useEdges();
  const drivingEdge = paramHandleId
    ? (edges.find((e) => e.targetHandle === paramHandleId) ?? null)
    : null;
  const opInstances = useContext(OpInstancesContext);
  const sourceHandleParsed =
    drivingEdge && parseOutputHandleId(drivingEdge.sourceHandle!);
  const sourceInstance = sourceHandleParsed
    ? (opInstances[sourceHandleParsed.nodeId] ?? null)
    : null;
  const subscribeToSource = useCallback(
    (cb: () => void) => sourceInstance?.subscribe(cb) ?? (() => {}),
    [sourceInstance],
  );
  useSyncExternalStore(
    subscribeToSource,
    () => sourceInstance?.getRevision() ?? 0,
  );
  const rawDriven =
    sourceInstance?.getRuntime()?.[sourceHandleParsed!.key] ?? null;
  const drivenValue = typeof rawDriven === "number" ? rawDriven : null;
  const driven = drivenValue !== null;

  useLayoutEffect(() => {
    if (nodeId) {
      void dragging; // force a re-render when dragging changes
      void driven; // handle geometry can change when a wire lands
      updateNodeInternals(nodeId);
    }
  }, [dragging, driven, nodeId, updateNodeInternals]);

  const takeSnapshot = useContext(TakeSnapshotContext);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverDisabled, setPopoverDisabled] = useState(false);

  // Double-click opens keyboard entry — the escape hatch for values that are
  // impractical to scrub to (fine precision, or outside the drag range).
  // Typed values are not clamped to [min, max] and not snapped to step.
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  // Guards against commit running twice (Enter triggers a blur as the input
  // unmounts) and suppresses the blur-commit after Escape.
  const editDoneRef = useRef(false);

  const startEditing = () => {
    setPopoverOpen(false);
    setEditText(String(value));
    editDoneRef.current = false;
    setEditing(true);
  };
  const commitEdit = () => {
    if (editDoneRef.current) return;
    editDoneRef.current = true;
    const parsed = parseFloat(editText);
    if (isFinite(parsed) && parsed !== value) {
      takeSnapshot();
      valueUP.$set(parsed);
    }
    setEditing(false);
  };
  const cancelEdit = () => {
    editDoneRef.current = true;
    setEditing(false);
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.stopPropagation();
      takeSnapshot();
      setDragging(true);
      let moved = false;
      let lastX = e.clientX;
      let current = value;
      const onPointerMove = (e: PointerEvent) => {
        moved = true;
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        const changePerPixel = (max - min) / 400;
        current = Math.min(max, Math.max(min, current + dx * changePerPixel));
        const snapped = Math.round(current / step) * step;
        valueUP.$set(+snapped.toFixed(4)); // kill floating-point nonsense
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

  const chip = (
    <Popover.Root
      open={popoverOpen && !driven && !editing}
      onOpenChange={(open) => {
        if (!popoverDisabled && !driven && !editing) {
          setPopoverOpen(open);
        }
      }}
    >
      <Popover.Trigger>
        <StableWidthSpan
          // Reserve room for the widest scrubbable value — but a typed-in or
          // wire-driven value can exceed the scrub range, so let the actual
          // display win when it's wider (instead of bleeding out of the pill).
          widest={((reserve, shown) =>
            shown.length > reserve.length ? shown : reserve)(
            widestParamValue(min, max, step),
            formatParamValue(driven ? drivenValue : value, step),
          )}
          className={clsx(
            // Violet is the category color for numbers throughout the UI.
            "tabular-nums select-none rounded px-1 font-semibold transition-colors",
            "text-center",
            driven
              ? "bg-violet-100 text-violet-700"
              : editing
                ? "bg-violet-100 text-violet-700 ring-1 ring-violet-400"
                : dragging
                  ? "cursor-ew-resize bg-violet-500 text-white ring-1 ring-violet-600"
                  : "cursor-ew-resize bg-violet-100 text-violet-700 hover:bg-violet-200",
          )}
          onPointerDown={driven || editing ? undefined : onPointerDown}
          onDoubleClick={driven || editing ? undefined : startEditing}
        >
          {editing ? (
            <input
              className="nodrag w-full cursor-text border-0 bg-transparent p-0 text-center text-inherit outline-none [font:inherit]"
              type="text"
              inputMode="decimal"
              value={editText}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitEdit();
                else if (e.key === "Escape") cancelEdit();
              }}
            />
          ) : driven ? (
            // Wavy underline marks an automated (wire-driven) value. It has
            // to sit on this inner span: text decorations don't reach into
            // StableWidthSpan's absolutely-positioned content span.
            <span className="underline decoration-wavy decoration-violet-400 underline-offset-2">
              {formatParamValue(drivenValue, step)}
            </span>
          ) : (
            formatParamValueExact(value, step)
          )}
        </StableWidthSpan>
      </Popover.Trigger>
      <MyPopoverContent
        className="!bg-violet-100 !border-violet-200 !shadow-lg"
        arrowClassName="fill-violet-100"
      >
        <div className="flex flex-row items-center gap-2">
          <div className="text-xs text-violet-700">{min}</div>
          <div className="w-32">
            <Slider
              color="violet"
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
          <div className="text-xs text-violet-700">{max}</div>
        </div>
      </MyPopoverContent>
    </Popover.Root>
  );

  if (!paramHandleId) return chip;

  // The chip itself is the drop target for number wires. Connections can't
  // *start* here (that would fight the scrub gesture), only land here.
  return (
    <Handle
      type="target"
      position={Position.Top}
      id={paramHandleId}
      isConnectableStart={false}
      className={clsx(
        "nodrag pointer-events-auto",
        "inline-flex rounded !bg-transparent",
        // light up while a compatible wire is being dragged
        "[&.connectionindicator]:ring-2 [&.connectionindicator]:ring-violet-400",
      )}
    >
      {chip}
    </Handle>
  );
};

export const MyPopoverContent = (
  props: React.ComponentProps<typeof Popover.Content> & {
    arrowClassName?: string;
  },
) => {
  const { overlayDiv } = useContext(OmniCanvasContext);
  const { arrowClassName, ...rest } = props;
  return (
    <Popover.Content
      {...rest}
      side="top"
      size="1"
      container={overlayDiv}
      className={clsx("pointer-events-auto overflow-visible", props.className)}
      onKeyDown={(e) => e.stopPropagation()}
      arrowPadding={10}
    >
      {props.children}
      <MyArrow className={arrowClassName} />
    </Popover.Content>
  );
};

export const MyArrow = ({ className }: { className?: string }) => (
  <PopoverPrimitive.Arrow
    width={20}
    height={10}
    className={className ?? "fill-[--color-panel-solid]"}
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
  a,
  rUP,
  gUP,
  bUP,
  aUP,
}: {
  r: number;
  g: number;
  b: number;
  /** Optional alpha channel — pass `a`/`aUP` together to enable an alpha slider. */
  a?: number;
  rUP: UpdateProxy<number>;
  gUP: UpdateProxy<number>;
  bUP: UpdateProxy<number>;
  aUP?: UpdateProxy<number>;
}) => {
  const takeSnapshot = useContext(TakeSnapshotContext);

  // ChromePicker fires onChange continuously while dragging; snapshot only on
  // the first change of an interaction (matching the number-param slider).
  const [dragging, setDragging] = useState(false);

  const swatchColor = aUP
    ? `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
        b * 255,
      )}, ${a ?? 1})`
    : `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
        b * 255,
      )})`;

  return (
    <Popover.Root>
      <Popover.Trigger>
        <button
          className="inline-block h-5 w-8 cursor-pointer rounded-md border border-gray-300 align-middle shadow-sm"
          style={{ backgroundColor: swatchColor }}
        />
      </Popover.Trigger>
      <MyPopoverContent>
        <Inset>
          <ChromePicker
            disableAlpha={!aUP}
            color={{ r: r * 255, g: g * 255, b: b * 255, a: a ?? 1 }}
            onChange={({ rgb }) => {
              if (!dragging) takeSnapshot();
              setDragging(true);
              rUP.$set(rgb.r / 255);
              gUP.$set(rgb.g / 255);
              bUP.$set(rgb.b / 255);
              aUP?.$set(rgb.a ?? 1);
            }}
            onChangeComplete={() => setDragging(false)}
          />
        </Inset>
      </MyPopoverContent>
    </Popover.Root>
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
    ? ((instance.getRuntime()?.[target.outputKey] as Tex | null) ?? null)
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

  const raw = sourceInstance?.getRuntime()?.[sourceHandleParsed!.key] ?? null;
  return isProbablyTex(raw) ? raw : null;
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
    ? (instance.getRuntime()?.[outputKey] as Tex | null)
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
            <div
              className="-m-[1px]"
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
            >
              <Monitor tex={output} cornerRadiusPixels={3} />
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
            {isHovered && (
              <span className="absolute bottom-0.5 left-0.5 text-[8px] text-white/90 leading-none bg-black/50 rounded px-0.5">
                {output.width}×{output.height}
              </span>
            )}
            {children}
          </OmniCanvasOverlay>
        )}
      </Handle>
    </>
  );
};

const SPARK_SAMPLES = 100;
const SPARK_W = 48;
const SPARK_H = 14;

const Sparkline = ({ values }: { values: number[] }) => {
  if (values.length < 2) {
    return <svg width={SPARK_W} height={SPARK_H} />;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * SPARK_W;
      const y =
        range === 0 ? SPARK_H / 2 : 1 + (SPARK_H - 2) * (1 - (v - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      className="overflow-visible text-violet-500"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

// Output handle for number-valued outputs: shows the live value plus a
// sparkline of its recent history, and is the drag source for number wires.
export const NumberOutputHandle = ({
  outputKey,
  position: positionProp,
}: {
  outputKey: string;
  position?: Position;
}) => {
  const nodeId = useNodeId();
  const opInstances = useContext(OpInstancesContext);
  const instance = nodeId !== null ? opInstances[nodeId] : null;
  const subscribe = useCallback(
    (cb: () => void) => instance?.subscribe(cb) ?? (() => {}),
    [instance],
  );
  useSyncExternalStore(subscribe, () => instance?.getRevision() ?? 0);

  const raw = instance?.getRuntime()?.[outputKey] ?? null;
  const value = typeof raw === "number" ? raw : null;

  // Rolling history for the sparkline. We sample on render (one render per
  // runtime change), skipping repeats so a constant signal doesn't scroll.
  const historyRef = useRef<number[]>([]);
  if (value !== null) {
    const h = historyRef.current;
    if (h.length === 0 || h[h.length - 1] !== value) {
      h.push(value);
      if (h.length > SPARK_SAMPLES) h.shift();
    }
  }

  if (!nodeId) return null;

  return (
    <Handle
      type="source"
      position={positionProp ?? Position.Bottom}
      id={makeOutputHandleId(nodeId, outputKey)}
      className={clsx(
        sharedHandleClasses,
        "inline-flex items-center gap-1.5 px-1.5 py-0.5",
        "rounded-md border-2 border-solid border-black hover:border-violet-300",
        "!bg-violet-100",
      )}
    >
      <Sparkline values={historyRef.current} />
      <span className="min-w-[5ch] text-center text-xs font-['Varela_Round'] font-semibold tabular-nums text-violet-700">
        {value !== null ? value.toFixed(2) : "–"}
      </span>
    </Handle>
  );
};

// we have a great new convention for handles!
// the handleId is nodeId:input:key, nodeId:output:key, or nodeId:param:key
// where key is any old thing the node wants to use
// (no using :s in the key, natch)
//
// :input: handles carry textures; :param: handles carry numbers, and land on
// the number chips rendered by SentenceParamNumber.

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
export function makeParamHandleId(nodeId: string, key: string): string {
  return `${nodeId}:param:${key}`;
}
export function parseParamHandleId(handleId: string): {
  nodeId: string;
  key: string;
} {
  const match = handleId.match(/^(.+):param:(.+)$/);
  if (!match) throw new Error(`Invalid param handleId: ${handleId}`);
  return { nodeId: match[1], key: match[2] };
}
export function isParamHandleId(
  handleId: string | null | undefined,
): handleId is string {
  return !!handleId && /^(.+):param:(.+)$/.test(handleId);
}
