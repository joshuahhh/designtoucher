import { autoUpdate } from "@floating-ui/dom";
import { TextField, Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  Handle,
  MiniMap,
  Node,
  NodeChange,
  NodeProps,
  NodeTypes,
  OnConnectEnd,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useConnection,
  useEdges,
  useReactFlow,
  useStoreApi,
  Viewport,
} from "@xyflow/react";
import { clsx } from "clsx";
import _ from "lodash";
import {
  createContext,
  Dispatch,
  memo,
  ReactNode,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FaTrash } from "react-icons/fa";
import {
  FaCompress,
  FaExpand,
  FaMagnifyingGlass,
  FaX,
  FaXmark,
} from "react-icons/fa6";
import { LuExpand, LuShrink } from "react-icons/lu";
import { useSearchParams } from "react-router-dom";
import { up } from "update-proxy";
import { examples } from "./examples.js";
import "./flow-base.css";
import { useKeyBindings } from "./keyboard.js";
import { Menu } from "./Menu.js";
import { Tex } from "./mygl.js";
import {
  Monitor,
  OmniCanvasContext,
  OmniCanvasContextType,
  OmniCanvasHost,
  OmniCanvasOverlay,
} from "./OmniCanvas.js";
import { OpList } from "./OpList.js";
import {
  AnyOpId,
  AnyOpInstance,
  InputHandle,
  isParamHandleId,
  makeInputHandleId,
  makeOutputHandleId,
  OpInstancesContext,
  OutputHandle,
  parseInputHandleId,
  parseOutputHandleId,
  PreviewApi,
  PreviewContext,
  PreviewFit,
  PreviewTarget,
  sharedHandleClasses,
  TakeSnapshotContext,
  usePreviewTex,
} from "./ops-core.js";
import {
  isCompatibleConnection,
  opById,
  OpNode,
  outputTypeForHandle,
  runFlow,
} from "./ops-flow.js";
import { ops, OpWithMetadata } from "./ops/all-the-ops.js";
import {
  ClipboardPayload,
  useCopyPaste,
  useNodeData,
  useReactFlowSelection,
} from "./react-flow-util.js";
import { getTransitiveDownstream, getTransitiveUpstream } from "./toposort.js";
import { PhoneCaptureState } from "./usePhoneCapture.js";
import { useRefForCallback } from "./useRefForCallback.js";
import { useUndo } from "./useUndo.js";
import { animate, tuple } from "./util.js";

function putOpsIntoGroups(ops: OpWithMetadata[]) {
  const groups: [string, OpWithMetadata[]][] = [];
  for (const op of ops) {
    const group = groups.find(([name]) => name === op.groupName);
    if (group) {
      group[1].push(op);
    } else {
      groups.push([op.groupName, [op]]);
    }
  }
  for (const group of groups) {
    group[1] = _.sortBy(group[1], (op) => op.opNum);
  }
  return _.sortBy(groups, ([, [firstOp]]) => firstOp.groupNum);
}

export const OpNodeView = memo(function OpNodeView(props: NodeProps<OpNode>) {
  const [data, setData] = useNodeData(props);
  const dataUP = up(setData);

  const { selected } = props;

  // useEffect(() => {
  //   console.log("OpNodeView mounted", props.id);
  //   return () => {
  //     console.log("OpNodeView unmounted", props.id);
  //   };
  // }, [props.id]);

  const opInstances = useContext(OpInstancesContext);

  const instance = opInstances[props.id];

  if (!instance) {
    return null;
  }

  return (
    <div
      className={clsx(
        "group/node flex flex-col gap-1 items-center border rounded-md bg-gray-100 p-2 !-z-10 transition-all duration-100 relative",
        selected
          ? [
              "border-blue-400 border-2",
              "shadow-lg shadow-blue-200/20",
              "ring-1 ring-blue-300/15",
            ]
          : ["border-gray-300", "hover:border-blue-300 hover:shadow-sm"],
      )}
    >
      <div
        data-drag-mode="upstream"
        className="absolute right-1 top-0 -translate-y-1/2 h-2.5 w-5 bg-gray-400 hover:bg-blue-400 rounded-sm cursor-grab active:cursor-grabbing opacity-0 group-hover/node:opacity-40 hover:!opacity-100 transition-opacity"
        title="Drag with upstream"
      />
      <div
        data-drag-mode="downstream"
        className="absolute right-1 bottom-0 translate-y-1/2 h-2.5 w-5 bg-gray-400 hover:bg-orange-400 rounded-sm cursor-grab active:cursor-grabbing opacity-0 group-hover/node:opacity-40 hover:!opacity-100 transition-opacity"
        title="Drag with downstream"
      />
      <instance.Render params={data.params} paramsUP={dataUP.params} />
    </div>
  );
});

const TransformPickerContext = createContext<
  (nodeId: string, opId: AnyOpId) => void
>(() => {});

// Stub handles for picker op previews — prevents real handles from
// registering inside the picker node's React Flow context.
const StubInputHandle = () => (
  <div
    className={clsx(
      sharedHandleClasses,
      "inline-flex border-2 border-solid border-black w-4 h-4 align-text-bottom",
    )}
  />
);
const StubOutputHandle = () => null;

const PickerNodeView = memo(function PickerNodeView(
  props: NodeProps<PickerNode>,
) {
  const transformPicker = useContext(TransformPickerContext);
  const { selected } = props;
  const mode = props.data.mode;
  const isOutput = mode === "output";

  const edges = useEdges();
  const connectionCount = edges.filter((e) =>
    isOutput ? e.source === props.id : e.target === props.id,
  ).length;
  const handleCount = connectionCount + 1; // +1 for next drop target

  // Highlight when a connection drag is hovering over any of THIS picker's handles
  const isConnectionHovering = useConnection(
    (c) => c.toHandle?.nodeId === props.id,
  );

  const [searchInput, setSearchInput] = useState("");
  const searchQuery = searchInput.toLowerCase().trim();

  const searchInputRef = useCallback((el: HTMLInputElement | null) => {
    el?.focus();
  }, []);

  // Only show ops that have enough inputs/outputs for the number of connections
  const applicableOpsInGroups = useMemo(
    () =>
      putOpsIntoGroups(ops)
        .map(([groupName, groupOps]) =>
          tuple([
            groupName,
            groupOps.filter((op) =>
              isOutput
                ? (op.outputKeys ?? ["out"]).length >= connectionCount
                : (op.inputKeys?.length ?? 0) +
                    (op.inputKeysLate?.length ?? 0) >=
                  connectionCount,
            ),
          ]),
        )
        .filter(([, groupOps]) => groupOps.length > 0),
    [connectionCount, isOutput],
  );

  const renderOpWrapper = useCallback(
    (opId: AnyOpId, children: React.ReactNode) => (
      <div
        onClick={() => transformPicker(props.id, opId)}
        className="w-full text-left p-2 bg-white border border-gray-200 rounded-md cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all [&>*]:pointer-events-none"
      >
        {children}
      </div>
    ),
    [transformPicker, props.id],
  );

  return (
    <div
      className={clsx(
        "relative flex flex-col bg-gray-50 border-2 rounded-lg shadow-md w-64 max-h-80 transition-all duration-100",
        selected
          ? [
              "border-blue-400",
              "shadow-lg shadow-blue-200/20",
              "ring-1 ring-blue-300/15",
            ]
          : isConnectionHovering
            ? "border-blue-300 shadow-lg shadow-blue-200/30 ring-2 ring-blue-200/40"
            : ["border-gray-300", "hover:border-blue-300 hover:shadow-sm"],
      )}
    >
      {Array.from({ length: handleCount }, (_, i) => (
        <Handle
          key={i}
          type={isOutput ? "source" : "target"}
          position={isOutput ? Position.Bottom : Position.Top}
          id={
            isOutput
              ? makeOutputHandleId(props.id, `_picker_${i}`)
              : makeInputHandleId(props.id, `_picker_${i}`)
          }
          isConnectableStart={isOutput ? undefined : false}
          isConnectableEnd={isOutput ? false : undefined}
          style={{
            position: "absolute",
            left: `${((i + 1) / (handleCount + 1)) * 100}%`,
            ...(isOutput
              ? { bottom: 0, transform: "translate(-50%, 50%)" }
              : { top: 0, transform: "translate(-50%, -50%)" }),
          }}
          className={clsx(
            sharedHandleClasses,
            "!w-3 !h-3 !border-2 !border-black",
          )}
        />
      ))}
      <div className="p-2 border-b border-gray-200 shrink-0">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search for a component…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="nodrag w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
        />
      </div>
      <div className="overflow-auto p-2 nowheel [@media(pointer:coarse)]:nodrag">
        <OpList
          opsInGroups={applicableOpsInGroups}
          searchQuery={searchQuery}
          renderOpWrapper={renderOpWrapper}
          InputHandle={StubInputHandle}
          OutputHandle={StubOutputHandle}
          groupClassName="mb-3"
          groupHeadingClassName="text-xs text-gray-500 font-bold mb-1 px-1"
          gapClassName="gap-1"
        />
      </div>
    </div>
  );
});

const nodeTypes: NodeTypes = {
  operation: OpNodeView,
  picker: PickerNodeView,
};

export const Flow = ({
  flow,
  setFlow,
  phoneCapture,
}: {
  flow: Flow;
  setFlow: Dispatch<SetStateAction<Flow>>;
  phoneCapture: PhoneCaptureState;
}) => (
  <div className="flex w-full h-full overflow-hidden box-border relative">
    <ReactFlowProvider>
      <OmniCanvasHost>
        {/* !min-h-[initial] is to override some default radix-theme thing that uses dvh and messes up height on ipad (!!!) */}
        <Theme appearance="light" className="w-full h-full !min-h-[initial]">
          <FlowInner
            flow={flow}
            setFlow={setFlow}
            phoneCapture={phoneCapture}
          />
        </Theme>
      </OmniCanvasHost>
    </ReactFlowProvider>
  </div>
);

type PickerNode = Node<{ mode: "input" | "output" }, "picker">;

type FlowNode = OpNode | PickerNode;

export type Flow = {
  nodes: FlowNode[];
  edges: Edge[];
  viewport: Viewport;
};

const getId = () => `n${Math.random().toString(16).slice(2)}`;

// Handle ids embed their node id (`${nodeId}:input:${key}`), so when a
// node is given a fresh id on paste, the ids of edges connected to it
// must be rewritten to point at the new node id.
const remapHandleId = (
  handleId: string | null | undefined,
  idMap: Map<string, string>,
): string | null => {
  if (!handleId) return null;
  const match = handleId.match(/^(.+):(input|output|param):(.+)$/);
  if (!match) return handleId;
  const newNodeId = idMap.get(match[1]) ?? match[1];
  return `${newNodeId}:${match[2]}:${match[3]}`;
};

// A param handle holds at most one wire: when a new connection lands on an
// occupied param, the newest edge (last in the array) replaces the old one.
function keepNewestParamEdges(edges: Edge[]): Edge[] {
  const newest = new Map<string, Edge>();
  for (const e of edges) {
    if (isParamHandleId(e.targetHandle)) newest.set(e.targetHandle, e);
  }
  if (newest.size === 0) return edges;
  const filtered = edges.filter(
    (e) => !isParamHandleId(e.targetHandle) || newest.get(e.targetHandle) === e,
  );
  return filtered.length === edges.length ? edges : filtered;
}

// Clone a copied selection with fresh ids: every node gets a new id, edge
// endpoints and handle ids are remapped through that id map, and the whole
// group is shifted by (dx, dy). Edges whose endpoints aren't both in the
// selection are dropped (they'd dangle).
const cloneForPaste = (
  payload: ClipboardPayload,
  dx: number,
  dy: number,
): { nodes: FlowNode[]; edges: Edge[] } => {
  const idMap = new Map<string, string>();
  for (const n of payload.nodes) idMap.set(n.id, getId());

  const nodes = payload.nodes.map((n) => ({
    ...n,
    id: idMap.get(n.id)!,
    position: { x: n.position.x + dx, y: n.position.y + dy },
    selected: true,
    dragging: false,
  })) as FlowNode[];

  const edges = payload.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => {
      const source = idMap.get(e.source)!;
      const target = idMap.get(e.target)!;
      const sourceHandle = remapHandleId(e.sourceHandle, idMap);
      const targetHandle = remapHandleId(e.targetHandle, idMap);
      return {
        ...e,
        id: `xy-edge__${source}${sourceHandle ?? ""}-${target}${targetHandle ?? ""}`,
        source,
        target,
        sourceHandle,
        targetHandle,
        selected: true,
      };
    });

  return { nodes, edges };
};

const FlowInner = ({
  flow,
  setFlow,
  phoneCapture,
}: {
  flow: Flow;
  setFlow: Dispatch<SetStateAction<Flow>>;
  phoneCapture: PhoneCaptureState;
}) => {
  const ctx = useContext(OmniCanvasContext);

  const [opInstances, setOpInstances] = useState<Record<string, AnyOpInstance>>(
    {},
  );

  const flowUP = up(setFlow);

  const flowRef = useRefForCallback(flow);
  const opInstancesRef = useRefForCallback(opInstances);

  useEffect(() => {
    return animate(() => {
      try {
        const opNodes = flowRef.current.nodes.filter(
          (n): n is OpNode => n.type === "operation",
        );
        const opNodeIds = new Set(opNodes.map((n) => n.id));
        const opEdges = flowRef.current.edges.filter(
          (e) => opNodeIds.has(e.source) && opNodeIds.has(e.target),
        );
        const instancesChanged = runFlow(
          opNodes,
          opEdges,
          opInstancesRef.current,
          ctx,
          (nodeId, params) => {
            flowUP.nodes.$all
              .$if((n) => n.id === nodeId)
              .data.params.$set(params);
          },
        );
        if (instancesChanged) {
          setOpInstances((prev) => ({ ...prev }));
        }
      } catch (e) {
        console.error("runFlow:", e);
      }
    });
  }, [flowRef, ctx, flowUP, opInstancesRef]);

  // Preview state. A preview shows one op *output* (`target`); `fit` is cover
  // vs contain. The editor and preview share the width via `paneFraction` (the
  // preview's share, 0..1). There is no separate fullscreen mode — "fullscreen"
  // is just the editor dragged/collapsed to nothing (paneFraction → 1).
  //
  // The `?preview=nodeId:outputKey` search param deep-links into full-screen
  // preview. On mount we seed from the URL; changes sync back.
  const [searchParams, setSearchParams] = useSearchParams();
  const initPreview = useMemo((): PreviewTarget | null => {
    const p = searchParams.get("preview");
    if (!p) return null;
    const [nodeId, outputKey = "out"] = p.split(":");
    return { nodeId, outputKey };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(
    initPreview,
  );
  const [previewFit, setPreviewFit] = useState<PreviewFit>("cover");
  const [paneFraction, setPaneFraction] = useState(initPreview ? 1 : 0.5);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  // Width to restore the editor to when un-collapsing (via `f` / the button).
  const lastSplitFractionRef = useRef(0.5);

  const isFull = previewTarget !== null && paneFraction >= EDITOR_COLLAPSED_AT;

  const onSplitDrag = useCallback((clientX: number) => {
    const el = splitContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const f = Math.min(
      1,
      Math.max(MIN_PANE_FRACTION, (rect.right - clientX) / rect.width),
    );
    setPaneFraction(f);
  }, []);

  // Collapse the editor (full preview) <-> restore the last split width.
  const setFull = useCallback((full: boolean) => {
    setPaneFraction((f) => {
      if (full) {
        if (f < EDITOR_COLLAPSED_AT) lastSplitFractionRef.current = f;
        return 1;
      }
      return f >= EDITOR_COLLAPSED_AT ? lastSplitFractionRef.current : f;
    });
  }, []);

  const previewApi: PreviewApi = useMemo(
    () => ({
      target: previewTarget,
      mode: isFull ? "full" : "split",
      fit: previewFit,
      open: (target) => {
        setPreviewTarget(target);
        // Always reveal the editor when (re)opening a preview from a node.
        setFull(false);
      },
      setMode: (m) => setFull(m === "full"),
      setFit: setPreviewFit,
      close: () => setPreviewTarget(null),
    }),
    [previewTarget, isFull, previewFit, setFull],
  );

  // Sync full-screen preview state to/from the URL search param.
  useEffect(() => {
    if (previewTarget && isFull) {
      const val =
        previewTarget.outputKey === "out"
          ? previewTarget.nodeId
          : `${previewTarget.nodeId}:${previewTarget.outputKey}`;
      setSearchParams(
        (prev) => {
          prev.set("preview", val);
          return prev;
        },
        { replace: true },
      );
    } else {
      setSearchParams(
        (prev) => {
          prev.delete("preview");
          return prev;
        },
        { replace: true },
      );
    }
  }, [previewTarget, isFull, setSearchParams]);

  // Close the preview if its node disappears (deleted, or graph replaced).
  // The "seen" ref prevents clearing a URL-sourced target before IDB has loaded
  // the real graph — we only clear once the node has existed and then vanished.
  const previewNodeSeen = useRef(false);
  useEffect(() => {
    if (!previewTarget) {
      previewNodeSeen.current = false;
      return;
    }
    const exists = flow.nodes.some((n) => n.id === previewTarget.nodeId);
    if (exists) {
      previewNodeSeen.current = true;
    } else if (previewNodeSeen.current) {
      setPreviewTarget(null);
    }
  }, [flow.nodes, previewTarget]);

  // `f` collapses the editor for a full-width preview (and back); Escape
  // closes. Accelerators only — both are also reachable by the pane buttons
  // and by dragging the divider.
  useKeyBindings(
    useMemo(
      () =>
        previewTarget
          ? [
              { combo: "f", action: () => setFull(!isFull) },
              { combo: "Escape", action: () => setPreviewTarget(null) },
            ]
          : [],
      [previewTarget, isFull, setFull],
    ),
  );

  const resetOpInstances = useCallback(() => {
    setOpInstances({});
  }, []);

  useEffect(() => {
    const handler = () => resetOpInstances();
    window.addEventListener("ops-hmr", handler);
    return () => window.removeEventListener("ops-hmr", handler);
  }, [resetOpInstances]);

  return (
    <PreviewContext.Provider value={previewApi}>
      <OpInstancesContext.Provider value={opInstances}>
        <div ref={splitContainerRef} className="w-full h-full flex">
          <div
            className="min-w-0 relative"
            style={{
              flexGrow: previewTarget ? 1 - paneFraction : 1,
              flexBasis: 0,
            }}
          >
            <EditorOverlayClip>
              <FlowInnerNormalMode
                flow={flow}
                setFlow={setFlow}
                resetOpInstances={resetOpInstances}
                phoneCapture={phoneCapture}
              />
            </EditorOverlayClip>
          </div>
          {previewTarget && (
            <>
              <SplitDivider
                onDrag={onSplitDrag}
                onToggleFull={() => setFull(!isFull)}
              />
              <SplitPreviewPane
                target={previewTarget}
                growFraction={paneFraction}
              />
            </>
          )}
        </div>
      </OpInstancesContext.Provider>
    </PreviewContext.Provider>
  );
};

// The editor is considered "collapsed" (full-width preview) at/above this
// pane fraction; the divider clamps the preview no smaller than MIN.
const EDITOR_COLLAPSED_AT = 0.98;
const MIN_PANE_FRACTION = 0.15;

// Stacking priority for the split-screen preview on the shared OmniCanvas. Node
// previews default to 0; the pane must always paint above node thumbnails that
// spill into its region (guests draw into their full rect, ignoring the
// editor's overflow clip).
const PREVIEW_PRIORITY = 1000;

// The preview image surface. In "cover" mode the Monitor fills the pane and
// crops; in "contain" mode it is letterboxed at the texture's aspect ratio and
// centered.
const PreviewSurface = ({ tex, fit }: { tex: Tex; fit: PreviewFit }) => {
  if (fit === "cover") {
    return (
      <Monitor
        tex={tex}
        objectFit="cover"
        checkerboardPixels={100}
        priority={PREVIEW_PRIORITY}
      />
    );
  }
  const aspectRatio = tex.width / tex.height;
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div
        style={{
          width: `min(100cqw,calc(100cqh*${aspectRatio}))`,
          aspectRatio,
        }}
      >
        <Monitor
          tex={tex}
          checkerboardPixels={100}
          priority={PREVIEW_PRIORITY}
        />
      </div>
    </div>
  );
};

// Fit / collapse-editor / close controls for the preview pane. Lives in the
// overlay layer (above the WebGL canvas).
const PreviewControls = () => {
  const { mode, setMode, fit, setFit, close } = useContext(PreviewContext);
  const btn =
    "bg-black/70 text-white p-2 rounded hover:bg-black/90 transition-colors pointer-events-auto";
  return (
    <div className="absolute top-3 right-3 z-10 flex gap-1.5">
      <button
        onClick={() => setFit(fit === "cover" ? "contain" : "cover")}
        className={btn}
        title={
          fit === "cover"
            ? "Fit: show the whole frame"
            : "Fill: cover the area (may crop)"
        }
      >
        {fit === "cover" ? <LuShrink /> : <LuExpand />}
      </button>
      <button
        onClick={() => setMode(mode === "full" ? "split" : "full")}
        className={btn}
        title={mode === "full" ? "Exit fullscreen (f)" : "Fullscreen (f)"}
      >
        {mode === "full" ? <FaCompress /> : <FaExpand />}
      </button>
      <button onClick={close} className={btn} title="Close preview (Esc)">
        <FaXmark />
      </button>
    </div>
  );
};

const NoOutput = () => (
  <div className="absolute inset-0 grid place-items-center text-gray-500 text-sm select-none">
    No output yet
  </div>
);

// Draggable splitter between the editor and the preview pane. It sits in the
// underlay layer; the WebGL canvas above it is pointer-events:none, so it still
// receives the drag. Pointer capture keeps the drag alive over the canvas.
const SplitDivider = ({
  onDrag,
  onToggleFull,
}: {
  onDrag: (clientX: number) => void;
  onToggleFull: () => void;
}) => {
  const [dragging, setDragging] = useState(false);

  // While dragging, keep the resize cursor and suppress text selection
  // everywhere — not just over the thin divider.
  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  // The anchor reserves the 2px gutter in the flex row; the visible/draggable
  // strip is portaled into the overlay layer (above the WebGL canvas) by
  // OmniCanvasOverlay — same mechanism every other above-canvas control uses.
  return (
    <OmniCanvasOverlay className="w-2 h-full shrink-0 relative">
      <div
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) onDrag(e.clientX);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
        }}
        onDoubleClick={onToggleFull}
        className={clsx(
          "w-full h-full cursor-col-resize pointer-events-auto transition-colors",
          dragging ? "bg-blue-500" : "bg-gray-600 hover:bg-blue-500",
        )}
      />
    </OmniCanvasOverlay>
  );
};

const SplitPreviewPane = ({
  target,
  growFraction,
}: {
  target: PreviewTarget;
  growFraction: number;
}) => {
  const tex = usePreviewTex(target);
  const { fit } = useContext(PreviewContext);
  return (
    <div
      className="h-full min-w-0 bg-black relative [container-type:size] overflow-hidden"
      style={{ flexGrow: growFraction, flexBasis: 0 }}
    >
      {tex ? <PreviewSurface tex={tex} fit={fit} /> : <NoOutput />}
      <OmniCanvasOverlay className="absolute inset-0">
        <PreviewControls />
      </OmniCanvasOverlay>
    </div>
  );
};

// The editor's above-canvas overlays (chrome, node-handle buttons, the
// component sidebar) all portal into the single full-window overlay layer and
// are positioned at the editor's edges. With a preview pane alongside, nothing
// stops them spilling past the divider as the editor narrows. This gives the
// editor subtree its own overflow-hidden overlay div (tracking the editor
// region) so all of that content is clipped to the editor.
const EditorOverlayClip = ({ children }: { children: ReactNode }) => {
  const ctx = useContext(OmniCanvasContext);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [clip, setClip] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !clip) return;
    const update = () => {
      const cr = ctx.overlayDiv.getBoundingClientRect();
      const r = anchor.getBoundingClientRect();
      clip.style.transform = `translate(${r.left - cr.left}px, ${r.top - cr.top}px)`;
      clip.style.width = `${r.width}px`;
      clip.style.height = `${r.height}px`;
    };
    update();
    return autoUpdate(anchor, clip, update, { animationFrame: true });
  }, [anchor, clip, ctx.overlayDiv]);

  // Hand the subtree a context whose overlayDiv is our clipped div, so every
  // OmniCanvasOverlay inside portals (and positions) into it.
  const childCtx = useMemo(
    () => (clip ? { ...ctx, overlayDiv: clip } : ctx),
    [ctx, clip],
  );

  return (
    <>
      <div ref={setAnchor} className="absolute inset-0 pointer-events-none" />
      {createPortal(
        <div
          ref={setClip}
          className="absolute top-0 left-0 overflow-hidden pointer-events-none"
          style={{ willChange: "transform,width,height" }}
        />,
        ctx.overlayDiv,
      )}
      <OmniCanvasContext.Provider value={childCtx}>
        {children}
      </OmniCanvasContext.Provider>
    </>
  );
};

type ProvisionalConnection = {
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
  cyclic?: boolean;
};

/**
 * Would adding a data-flow edge source→target create a cycle among `edges`?
 * Data flows source→target, so a loop forms iff `target` can already reach
 * `source` going downstream — the new edge would close that path.
 */
function wouldCreateCycle(
  source: string,
  target: string,
  edges: Edge[],
): boolean {
  if (source === target) return true;
  return getTransitiveDownstream(target, edges).has(source);
}

/**
 * IDs of the existing edges that, together with a cyclic edge source→target,
 * form the loop — i.e. a shortest path of edges from `target` back to `source`.
 * `edges` should exclude the provisional edge itself.
 */
function findLoopEdgeIds(
  source: string,
  target: string,
  edges: Edge[],
): Set<string> {
  const adj = new Map<string, Edge[]>();
  for (const e of edges) {
    let outs = adj.get(e.source);
    if (!outs) {
      outs = [];
      adj.set(e.source, outs);
    }
    outs.push(e);
  }
  const prevEdge = new Map<string, Edge>();
  const visited = new Set<string>([target]);
  const queue = [target];
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    if (cur === source) break;
    for (const e of adj.get(cur) ?? []) {
      if (!visited.has(e.target)) {
        visited.add(e.target);
        prevEdge.set(e.target, e);
        queue.push(e.target);
      }
    }
  }
  const result = new Set<string>();
  let node = source;
  while (node !== target) {
    const e = prevEdge.get(node);
    if (!e) break;
    result.add(e.id);
    node = e.source;
  }
  return result;
}

function useConnectionFeedforward(
  flowRef: React.RefObject<Flow | null>,
  flowUP: { edges: { $: (fn: (edges: Edge[]) => Edge[]) => void } },
  provisionalRef: React.MutableRefObject<ProvisionalConnection | null>,
  snapshotTakenRef: React.MutableRefObject<boolean>,
  takeSnapshot: () => void,
) {
  const inProgress = useConnection((c) => c.inProgress);
  const fromHandle = useConnection((c) => c.fromHandle);
  const toHandle = useConnection((c) => c.toHandle);
  const { screenToFlowPosition, getNodes } = useReactFlow();
  const ffStore = useStoreApi();
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const preDragEdgesRef = useRef<Edge[] | null>(null);

  useEffect(() => {
    if (!inProgress) {
      setHoverNodeId(null);
      return;
    }

    const onMove = (e: PointerEvent) => {
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const nodes = getNodes();
      const hit = nodes.find((n) => {
        if (n.type !== "operation") return false;
        const w = n.measured?.width ?? 200;
        const h = n.measured?.height ?? 100;
        return (
          pos.x >= n.position.x - w / 2 &&
          pos.x <= n.position.x + w / 2 &&
          pos.y >= n.position.y - h / 2 &&
          pos.y <= n.position.y + h / 2
        );
      });
      setHoverNodeId(hit?.id ?? null);
    };

    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [inProgress, screenToFlowPosition, getNodes]);

  useEffect(() => {
    if (!inProgress) {
      flowUP.edges.$((edges) => {
        if (!edges.some((e) => e.data?.provisional)) return edges;
        // Drop loop-creating previews; commit the rest by clearing the flag.
        // A committed param edge replaces any older wire on the same param.
        return keepNewestParamEdges(
          edges
            .filter((e) => !(e.data?.provisional && e.data?.cyclic))
            .map((e) =>
              e.data?.provisional
                ? {
                    ...e,
                    data: {
                      ...e.data,
                      provisional: undefined,
                      cyclic: undefined,
                    },
                  }
                : e,
            ),
        );
      });
      provisionalRef.current = null;
      snapshotTakenRef.current = false;
      preDragEdgesRef.current = null;
      return;
    }

    if (!fromHandle?.id) return;

    if (!preDragEdgesRef.current) {
      preDragEdgesRef.current = flowRef.current?.edges ?? [];
    }

    const fromIsSource = fromHandle.type === "source";

    let target: ProvisionalConnection | null = null;

    // Same-node connections are allowed through here so a self-loop still gets
    // a preview edge (it'll be flagged cyclic and rejected). The hover-node-body
    // path below still excludes the origin node, so we don't flash red the
    // instant a drag starts over its own node.
    if (toHandle) {
      if (fromIsSource && toHandle.type === "target") {
        target = {
          source: fromHandle.nodeId,
          sourceHandle: fromHandle.id,
          target: toHandle.nodeId,
          targetHandle: toHandle.id ?? null,
        };
      } else if (!fromIsSource && toHandle.type === "source") {
        target = {
          source: toHandle.nodeId,
          sourceHandle: toHandle.id ?? null,
          target: fromHandle.nodeId,
          targetHandle: fromHandle.id,
        };
      }
    }

    if (!target && hoverNodeId && hoverNodeId !== fromHandle.nodeId) {
      const nodes = getNodes();
      const hitNode = nodes.find((n) => n.id === hoverNodeId);
      if (hitNode?.type === "operation") {
        const hitOp = opById((hitNode as OpNode).data.opId);
        if (fromIsSource) {
          let targetHandleId: string | undefined;
          const allInputKeys = [
            ...(hitOp.inputKeys ?? []),
            ...(hitOp.inputKeysLate ?? []),
          ];
          if (allInputKeys.length > 0) {
            targetHandleId = makeInputHandleId(hitNode.id, allInputKeys[0]);
          } else {
            const internal = ffStore.getState().nodeLookup.get(hitNode.id);
            const firstHandle = internal?.internals.handleBounds?.target?.[0];
            if (firstHandle?.id) targetHandleId = firstHandle.id;
          }
          if (targetHandleId) {
            target = {
              source: fromHandle.nodeId,
              sourceHandle: fromHandle.id,
              target: hitNode.id,
              targetHandle: targetHandleId,
            };
          }
        } else {
          let sourceHandleId: string | undefined;
          const allOutputKeys = hitOp.outputKeys ?? ["out"];
          if (allOutputKeys.length > 0) {
            sourceHandleId = makeOutputHandleId(hitNode.id, allOutputKeys[0]);
          } else {
            const internal = ffStore.getState().nodeLookup.get(hitNode.id);
            const firstHandle = internal?.internals.handleBounds?.source?.[0];
            if (firstHandle?.id) sourceHandleId = firstHandle.id;
          }
          if (sourceHandleId) {
            target = {
              source: hitNode.id,
              sourceHandle: sourceHandleId,
              target: fromHandle.nodeId,
              targetHandle: fromHandle.id,
            };
          }
        }
      }
    }

    // Type gate: number wires only land on param chips, textures only on
    // texture inputs. An incompatible candidate gets no preview edge.
    if (
      target &&
      !isCompatibleConnection(
        getNodes(),
        target.sourceHandle,
        target.targetHandle,
      )
    ) {
      target = null;
    }

    const prev = provisionalRef.current;
    const same =
      prev &&
      target &&
      prev.source === target.source &&
      prev.sourceHandle === target.sourceHandle &&
      prev.target === target.target &&
      prev.targetHandle === target.targetHandle;

    if (same) return;

    if (prev) {
      flowUP.edges.$((edges) =>
        edges.filter(
          (e) =>
            !(
              e.source === prev.source &&
              e.sourceHandle === prev.sourceHandle &&
              e.target === prev.target &&
              e.targetHandle === prev.targetHandle
            ),
        ),
      );
      provisionalRef.current = null;
    }

    if (target) {
      const preExisting = preDragEdgesRef.current!.some(
        (e) =>
          e.source === target!.source &&
          e.sourceHandle === target!.sourceHandle &&
          e.target === target!.target &&
          e.targetHandle === target!.targetHandle,
      );

      if (!preExisting) {
        const cyclic = wouldCreateCycle(
          target.source,
          target.target,
          preDragEdgesRef.current!,
        );
        // A cyclic preview will be rejected on drop, so don't snapshot for it —
        // that would leave a no-op entry in the undo history.
        if (!cyclic && !snapshotTakenRef.current) {
          takeSnapshot();
          snapshotTakenRef.current = true;
        }
        provisionalRef.current = { ...target, cyclic };
        flowUP.edges.$((edges) =>
          addEdge({ ...target!, data: { provisional: true, cyclic } }, edges),
        );
      }
    }
  }, [
    inProgress,
    fromHandle,
    toHandle,
    hoverNodeId,
    flowRef,
    flowUP,
    provisionalRef,
    snapshotTakenRef,
    takeSnapshot,
    getNodes,
    ffStore,
  ]);
}

const FlowInnerNormalMode = ({
  flow,
  setFlow,
  resetOpInstances,
  phoneCapture,
}: {
  flow: Flow;
  setFlow: Dispatch<SetStateAction<Flow>>;
  resetOpInstances: () => void;
  phoneCapture: PhoneCaptureState;
}) => {
  const ctx = useContext(OmniCanvasContext);
  const { screenToFlowPosition, getNodes } = useReactFlow();
  const store = useStoreApi();

  const { takeSnapshot, pushSnapshot, undo, redo } = useUndo(flow, setFlow);

  const flowRef = useRefForCallback(flow);
  const flowUP = up(setFlow);

  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [draggedOpId, setDraggedOpId] = useState<AnyOpId | null>(null);

  const provisionalRef = useRef<ProvisionalConnection | null>(null);
  const feedforwardSnapshotTakenRef = useRef(false);

  useConnectionFeedforward(
    flowRef,
    flowUP,
    provisionalRef,
    feedforwardSnapshotTakenRef,
    takeSnapshot,
  );

  const transformPicker = useCallback(
    (nodeId: string, opId: AnyOpId) => {
      takeSnapshot();
      const op = opById(opId);

      // Determine picker mode from the current node before replacing it
      const pickerNode = flow.nodes.find((n) => n.id === nodeId) as
        | PickerNode
        | undefined;
      const mode = pickerNode?.data.mode ?? "input";

      if (mode === "input") {
        const allInputKeys = [
          ...(op.inputKeys ?? []),
          ...(op.inputKeysLate ?? []),
        ];
        if (allInputKeys.length === 0) return;
      } else {
        const allOutputKeys = op.outputKeys ?? ["out"];
        if (allOutputKeys.length === 0) return;
      }

      // Replace picker node with op node
      flowUP.nodes.$((nodes) =>
        nodes.map((n) =>
          n.id === nodeId
            ? ({
                ...n,
                type: "operation" as const,
                origin: undefined,
                data: { opId, params: op.initParams?.() ?? {} },
              } satisfies OpNode)
            : n,
        ),
      );

      // Rewire edges from numbered picker handles to real handles
      flowUP.edges.$((edges) => {
        if (mode === "output") {
          const allOutputKeys = op.outputKeys ?? ["out"];
          let outputIndex = 0;
          return edges.map((e) => {
            if (
              e.source === nodeId &&
              /_picker_\d+$/.test(e.sourceHandle ?? "") &&
              outputIndex < allOutputKeys.length
            ) {
              return {
                ...e,
                sourceHandle: makeOutputHandleId(
                  nodeId,
                  allOutputKeys[outputIndex++],
                ),
              };
            }
            return e;
          });
        } else {
          const allInputKeys = [
            ...(op.inputKeys ?? []),
            ...(op.inputKeysLate ?? []),
          ];
          let inputIndex = 0;
          return edges.map((e) => {
            if (
              e.target === nodeId &&
              /_picker_\d+$/.test(e.targetHandle ?? "") &&
              inputIndex < allInputKeys.length
            ) {
              return {
                ...e,
                targetHandle: makeInputHandleId(
                  nodeId,
                  allInputKeys[inputIndex++],
                ),
              };
            }
            return e;
          });
        }
      });
    },
    [flow.nodes, flowUP.nodes, flowUP.edges, takeSnapshot],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) =>
      flowUP.nodes.$as<Node[]>().$((nodes) => applyNodeChanges(changes, nodes)),
    [flowUP.nodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      flowUP.edges.$((edges) => applyEdgeChanges(changes, edges)),
    [flowUP.edges],
  );

  // Group drag: drag a node along with all upstream or downstream nodes
  const groupDragRef = useRef<{
    groupNodeIds: Set<string>;
    startPositions: Map<string, { x: number; y: number }>;
    dragNodeStartPos: { x: number; y: number };
  } | null>(null);

  // Stash pre-drag snapshot so we only push to undo if the node actually moved
  const preDragSnapshotRef = useRef<{
    nodes: Flow["nodes"];
    edges: Flow["edges"];
  } | null>(null);

  const onNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      preDragSnapshotRef.current = { nodes: flow.nodes, edges: flow.edges };

      // Walk up from event target to find a data-drag-mode attribute
      let target = _event.target as HTMLElement | null;
      let dragMode: "upstream" | "downstream" | null = null;
      while (target) {
        const mode = target.dataset?.dragMode;
        if (mode === "upstream" || mode === "downstream") {
          dragMode = mode;
          break;
        }
        if (target.classList.contains("react-flow__node")) break;
        target = target.parentElement;
      }

      if (!dragMode) {
        groupDragRef.current = null;
        return;
      }

      const groupNodeIds =
        dragMode === "upstream"
          ? getTransitiveUpstream(node.id, flow.edges)
          : getTransitiveDownstream(node.id, flow.edges);

      if (groupNodeIds.size === 0) {
        groupDragRef.current = null;
        return;
      }

      const startPositions = new Map<string, { x: number; y: number }>();
      for (const n of flow.nodes) {
        if (groupNodeIds.has(n.id)) {
          startPositions.set(n.id, { x: n.position.x, y: n.position.y });
        }
      }

      groupDragRef.current = {
        groupNodeIds,
        startPositions,
        dragNodeStartPos: { x: node.position.x, y: node.position.y },
      };
    },
    [flow.edges, flow.nodes],
  );

  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const group = groupDragRef.current;
      if (!group) return;

      const dx = node.position.x - group.dragNodeStartPos.x;
      const dy = node.position.y - group.dragNodeStartPos.y;

      flowUP.nodes.$((nodes) =>
        nodes.map((n) => {
          if (!group.groupNodeIds.has(n.id)) return n;
          const sp = group.startPositions.get(n.id);
          if (!sp) return n;
          return { ...n, position: { x: sp.x + dx, y: sp.y + dy } };
        }),
      );
    },
    [flowUP.nodes],
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      groupDragRef.current = null;
      const snapshot = preDragSnapshotRef.current;
      preDragSnapshotRef.current = null;
      if (!snapshot) return;

      // Only push to undo if the node actually moved
      const oldNode = snapshot.nodes.find((n) => n.id === node.id);
      if (
        oldNode &&
        oldNode.position.x === node.position.x &&
        oldNode.position.y === node.position.y
      )
        return;

      pushSnapshot(snapshot);
    },
    [pushSnapshot],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      // Refuse type-mismatched connections (number wires only into param
      // chips, textures only into texture inputs).
      if (
        !isCompatibleConnection(
          flowRef.current?.nodes ?? [],
          params.sourceHandle,
          params.targetHandle,
        )
      ) {
        provisionalRef.current = null;
        feedforwardSnapshotTakenRef.current = false;
        return;
      }
      // Refuse connections that would create a loop. The cyclic preview edge (if
      // any) is left for the feedforward cleanup to remove on drag-end.
      const baseEdges = (flowRef.current?.edges ?? []).filter(
        (e) => !e.data?.provisional,
      );
      if (
        params.source &&
        params.target &&
        wouldCreateCycle(params.source, params.target, baseEdges)
      ) {
        provisionalRef.current = null;
        feedforwardSnapshotTakenRef.current = false;
        return;
      }
      if (!provisionalRef.current) {
        takeSnapshot();
      }
      provisionalRef.current = null;
      feedforwardSnapshotTakenRef.current = false;
      // Texture handles accept multiple connections (multi-edges get implicitly
      // summed); a param handle keeps only its newest wire.
      flowUP.edges.$((edges) => keepNewestParamEdges(addEdge(params, edges)));
    },
    [flowUP.edges, takeSnapshot, flowRef],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }, []);

  // Replace the whole graph with a loaded flow (from the examples list or a
  // dropped file). Resetting op instances first tears down the live WebGL
  // runtimes so they get rebuilt for the new graph.
  const loadFlow = useCallback(
    (data: Flow) => {
      resetOpInstances();
      setFlow(data);
    },
    [resetOpInstances, setFlow],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (event.dataTransfer.files.length > 0) {
        const file = event.dataTransfer.files[0];
        if (file.type === "application/json") {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const data = JSON.parse(e.target?.result as string);
              loadFlow(data);
            } catch (err) {
              console.error("Failed to load flow from file", err);
            }
          };
          reader.readAsText(file);
        }
        return;
      }

      if (!draggedOpId) return;

      takeSnapshot();
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const op = opById(draggedOpId);

      const newNode: OpNode = {
        id: getId(),
        type: "operation",
        position,
        data: {
          opId: draggedOpId,
          params: op.initParams?.() ?? {},
        },
      };

      flowUP.nodes.$((nodes) => [...nodes, newNode]);
      setDraggedOpId(null);
    },
    [draggedOpId, screenToFlowPosition, flowUP.nodes, loadFlow, takeSnapshot],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (connectionState.isValid) {
        provisionalRef.current = null;
        feedforwardSnapshotTakenRef.current = false;
        return;
      }

      if (provisionalRef.current) {
        provisionalRef.current = null;
        feedforwardSnapshotTakenRef.current = false;
        return;
      }

      const { fromHandle } = connectionState;
      if (!fromHandle?.id) return;

      // Determine if the drag came from an output or input handle
      let mode: "input" | "output";
      try {
        parseOutputHandleId(fromHandle.id);
        mode = "input"; // dragging from output → picker receives inputs
      } catch {
        try {
          parseInputHandleId(fromHandle.id);
          mode = "output"; // dragging from input → picker produces outputs
        } catch {
          return;
        }
      }

      // Number wires land only on param chips (handled by the feedforward /
      // handle drops) — no picker or body-drop fallbacks for them.
      if (
        mode === "input" &&
        outputTypeForHandle(getNodes(), fromHandle.id) === "number"
      ) {
        return;
      }

      const { clientX, clientY } =
        "changedTouches" in event ? event.changedTouches[0] : event;

      takeSnapshot();
      const dropPosition = screenToFlowPosition({ x: clientX, y: clientY });

      // Check if dropped on an existing picker node with matching mode
      const rfNodes = getNodes();
      const hitPicker = rfNodes.find((n) => {
        if (n.type !== "picker") return false;
        if ((n as PickerNode).data.mode !== mode) return false;
        const w = n.measured?.width ?? 256;
        const h = n.measured?.height ?? 320;
        const left = n.position.x - w / 2;
        // origin=[0.5,0] for input mode, [0.5,1] for output mode
        const top = mode === "output" ? n.position.y - h : n.position.y;
        return (
          dropPosition.x >= left &&
          dropPosition.x <= left + w &&
          dropPosition.y >= top &&
          dropPosition.y <= top + h
        );
      });

      if (hitPicker) {
        flowUP.edges.$((edges) => {
          const nextIndex = edges.filter((e) =>
            mode === "output"
              ? e.source === hitPicker.id
              : e.target === hitPicker.id,
          ).length;
          const pickerHandle =
            mode === "output"
              ? makeOutputHandleId(hitPicker.id, `_picker_${nextIndex}`)
              : makeInputHandleId(hitPicker.id, `_picker_${nextIndex}`);
          return addEdge(
            mode === "output"
              ? {
                  source: hitPicker.id,
                  sourceHandle: pickerHandle,
                  target: fromHandle.nodeId,
                  targetHandle: fromHandle.id ?? null,
                }
              : {
                  source: fromHandle.nodeId,
                  sourceHandle: fromHandle.id ?? null,
                  target: hitPicker.id,
                  targetHandle: pickerHandle,
                },
            edges,
          );
        });
        return;
      }

      // Dropped on an operation node's body → connect to its first input/output
      const hitOpNode = rfNodes.find((n) => {
        if (n.type !== "operation") return false;
        if (n.id === fromHandle.nodeId) return false;
        const w = n.measured?.width ?? 200;
        const h = n.measured?.height ?? 100;
        // nodeOrigin is [0.5, 0.5]
        const left = n.position.x - w / 2;
        const top = n.position.y - h / 2;
        return (
          dropPosition.x >= left &&
          dropPosition.x <= left + w &&
          dropPosition.y >= top &&
          dropPosition.y <= top + h
        );
      }) as OpNode | undefined;

      if (hitOpNode) {
        // Refuse a body-drop connection that would create a loop.
        const candSource = mode === "input" ? fromHandle.nodeId : hitOpNode.id;
        const candTarget = mode === "input" ? hitOpNode.id : fromHandle.nodeId;
        if (
          wouldCreateCycle(candSource, candTarget, flowRef.current?.edges ?? [])
        ) {
          return;
        }
        const hitOp = opById(hitOpNode.data.opId);
        if (mode === "input") {
          let targetHandle: string | undefined;
          const allInputKeys = [
            ...(hitOp.inputKeys ?? []),
            ...(hitOp.inputKeysLate ?? []),
          ];
          if (allInputKeys.length > 0) {
            targetHandle = makeInputHandleId(hitOpNode.id, allInputKeys[0]);
          } else {
            const internal = store.getState().nodeLookup.get(hitOpNode.id);
            const firstHandle = internal?.internals.handleBounds?.target?.[0];
            if (firstHandle?.id) targetHandle = firstHandle.id;
          }
          if (
            targetHandle &&
            isCompatibleConnection(rfNodes, fromHandle.id, targetHandle)
          ) {
            flowUP.edges.$((edges) =>
              addEdge(
                {
                  source: fromHandle.nodeId,
                  sourceHandle: fromHandle.id ?? null,
                  target: hitOpNode.id,
                  targetHandle,
                },
                edges,
              ),
            );
            return;
          }
        } else {
          let sourceHandle: string | undefined;
          const allOutputKeys = hitOp.outputKeys ?? ["out"];
          if (allOutputKeys.length > 0) {
            sourceHandle = makeOutputHandleId(hitOpNode.id, allOutputKeys[0]);
          } else {
            const internal = store.getState().nodeLookup.get(hitOpNode.id);
            const firstHandle = internal?.internals.handleBounds?.source?.[0];
            if (firstHandle?.id) sourceHandle = firstHandle.id;
          }
          if (
            sourceHandle &&
            isCompatibleConnection(rfNodes, sourceHandle, fromHandle.id)
          ) {
            flowUP.edges.$((edges) =>
              addEdge(
                {
                  source: hitOpNode.id,
                  sourceHandle,
                  target: fromHandle.nodeId,
                  targetHandle: fromHandle.id ?? null,
                },
                edges,
              ),
            );
            return;
          }
        }
      }

      const PICKER_ENABLED = false;
      if (PICKER_ENABLED) {
        const newNodeId = getId();
        const newNode: PickerNode = {
          id: newNodeId,
          type: "picker",
          position: dropPosition,
          origin: mode === "output" ? [0.5, 1] : [0.5, 0],
          data: { mode },
        };

        const pickerHandle =
          mode === "output"
            ? makeOutputHandleId(newNodeId, "_picker_0")
            : makeInputHandleId(newNodeId, "_picker_0");

        const newEdge =
          mode === "output"
            ? {
                source: newNodeId,
                sourceHandle: pickerHandle,
                target: fromHandle.nodeId,
                targetHandle: fromHandle.id ?? null,
              }
            : {
                source: fromHandle.nodeId,
                sourceHandle: fromHandle.id ?? null,
                target: newNodeId,
                targetHandle: pickerHandle,
              };

        flowUP.nodes.$((nodes) => [...nodes, newNode]);
        flowUP.edges.$((edges) => addEdge(newEdge, edges));
      }
    },
    [
      screenToFlowPosition,
      flowUP.nodes,
      flowUP.edges,
      getNodes,
      takeSnapshot,
      store,
      flowRef,
    ],
  );

  useKeyBindings([
    {
      combo: "c+z",
      action: (e) => {
        e.preventDefault();
        undo();
      },
    },
    {
      combo: "c+s+z,c+y",
      action: (e) => {
        e.preventDefault();
        redo();
      },
    },
    {
      combo: "c+s+r",
      action: resetOpInstances,
    },
    {
      combo: "c+s",
      action: (e) => {
        e.preventDefault();
        const flowData = JSON.stringify(flow, null, 2);
        const blob = new Blob([flowData], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "design-toucher.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
    },
  ]);

  const { getEdges, deleteElements } = useReactFlow();

  const onPaneClick = useCallback(() => {
    store.setState({ connectionClickStartHandle: null });
  }, [store]);

  const deleteSelected = useCallback(() => {
    const selectedNodes = getNodes().filter((node) => node.selected);
    const selectedEdges = getEdges().filter((edge) => edge.selected);
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;

    takeSnapshot();
    deleteElements({ nodes: selectedNodes, edges: selectedEdges });
  }, [getNodes, getEdges, deleteElements, takeSnapshot]);

  // Track the pointer so a paste lands under the cursor (works nicely both
  // for same-project pastes and for pasting into a different project).
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const getSelection = useCallback(() => {
    const selectedNodes = getNodes().filter((n) => n.selected);
    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    // Only copy edges whose endpoints are both in the selection; edges to
    // un-copied nodes would dangle.
    const internalEdges = getEdges().filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
    );
    // Strip transient runtime fields; keep only what defines the node/edge.
    const nodes = selectedNodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      origin: n.origin,
      data: n.data,
    })) as Node[];
    const edges = internalEdges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
    }));
    return { nodes, edges };
  }, [getNodes, getEdges]);

  const onPaste = useCallback(
    (payload: ClipboardPayload) => {
      if (payload.nodes.length === 0) return;

      // Shift the pasted group so its center sits under the cursor; fall
      // back to a small offset if we have no pointer position yet.
      let dx = 20;
      let dy = 20;
      const pointer = lastPointerRef.current;
      if (pointer) {
        const cx =
          payload.nodes.reduce((s, n) => s + n.position.x, 0) /
          payload.nodes.length;
        const cy =
          payload.nodes.reduce((s, n) => s + n.position.y, 0) /
          payload.nodes.length;
        const target = screenToFlowPosition(pointer);
        dx = target.x - cx;
        dy = target.y - cy;
      }

      const { nodes: newNodes, edges: newEdges } = cloneForPaste(
        payload,
        dx,
        dy,
      );

      setFlow((f) => ({
        ...f,
        nodes: [
          ...f.nodes.map((n) => ({ ...n, selected: false })),
          ...newNodes,
        ],
        edges: [
          ...f.edges.map((e) => ({ ...e, selected: false })),
          ...newEdges,
        ],
      }));
    },
    [screenToFlowPosition, setFlow],
  );

  useCopyPaste({ getSelection, onPaste });

  const styledEdges = useMemo(() => {
    // While a loop-creating wire is being previewed, also highlight the existing
    // edges that close the loop.
    const cyclicProvisional = flow.edges.find(
      (e) => e.data?.provisional && e.data?.cyclic,
    );
    const loopEdgeIds = cyclicProvisional
      ? findLoopEdgeIds(
          cyclicProvisional.source,
          cyclicProvisional.target,
          flow.edges.filter((e) => e.id !== cyclicProvisional.id),
        )
      : null;
    return flow.edges.map((e) => {
      // TODO: we should prob make a custom edge at some point
      let isLate = false;
      if (!isParamHandleId(e.targetHandle)) {
        const { nodeId, key } = parseInputHandleId(e.targetHandle!);
        const node = flow.nodes.find((n) => n.id === nodeId);
        const op = node?.type === "operation" ? opById(node.data.opId) : null;
        isLate = op?.inputKeysLate?.includes(key) ?? false;
      }
      return {
        ...e,
        className: clsx({
          "[stroke-dasharray:5,5]": isLate,
          // Number wires are violet, the category color for numbers. (The
          // per-edge var still loses to selected/cyclic/loop styling.)
          "[--xy-edge-stroke-default:theme(colors.violet.600)]":
            isParamHandleId(e.targetHandle),
          "cyclic-edge": e.data?.provisional && e.data?.cyclic,
          "loop-edge": loopEdgeIds?.has(e.id),
        }),
      };
    });
  }, [flow.edges, flow.nodes]);

  // Native xyflow validity: makes snapping and the .connectionindicator
  // highlight type-aware (number wires light up param chips, not tex inputs).
  const isValidConnection = useCallback(
    (conn: Edge | Connection) =>
      isCompatibleConnection(
        flowRef.current?.nodes ?? [],
        conn.sourceHandle,
        conn.targetHandle,
      ),
    [flowRef],
  );

  return (
    <TakeSnapshotContext.Provider value={takeSnapshot}>
      <TransformPickerContext.Provider value={transformPicker}>
        <div className="w-full h-full flex">
          <div className="flex-1 relative">
            <ReactFlow
              nodes={flow.nodes}
              edges={styledEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              onNodeDragStart={onNodeDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              nodeTypes={nodeTypes}
              maxZoom={10}
              minZoom={0.1}
              viewport={flow.viewport}
              onViewportChange={flowUP.viewport.$set}
              onDragOver={onDragOver}
              onDrop={onDrop}
              nodeOrigin={[0.5, 0.5]}
              className="[--xy-edge-stroke-default:#000] [--xy-edge-stroke-selected:theme(colors.blue.500)]"
              onPaneClick={onPaneClick}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <OmniCanvasOverlay className="absolute top-0 left-0 w-full h-full">
                <div className="contents pointer-events-auto">
                  <MiniMap zoomable pannable />
                  <Controls className="bg-gray-50" />
                  <SidebarToggleButton
                    isSidebarExpanded={isSidebarExpanded}
                    setIsSidebarExpanded={setIsSidebarExpanded}
                  />
                  <Toolbar
                    onDelete={deleteSelected}
                    flow={flow}
                    loadFlow={loadFlow}
                    phoneCapture={phoneCapture}
                  />
                </div>
              </OmniCanvasOverlay>
            </ReactFlow>
          </div>
          <Sidebar
            isSidebarExpanded={isSidebarExpanded}
            setDraggedOpId={setDraggedOpId}
            loadFlow={loadFlow}
            ctx={ctx}
          />
        </div>
      </TransformPickerContext.Provider>
    </TakeSnapshotContext.Provider>
  );
};

const Toolbar = memo(function Toolbar({
  onDelete,
  flow,
  loadFlow,
  phoneCapture,
}: {
  onDelete: () => void;
  flow: Flow;
  loadFlow: (flow: Flow) => void;
  phoneCapture: PhoneCaptureState;
}) {
  const { selectedNodes, selectedEdges } = useReactFlowSelection<Node, Edge>();
  const hasSelection = selectedNodes.length > 0 || selectedEdges.length > 0;

  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 select-none">
      <Menu flow={flow} loadFlow={loadFlow} phoneCapture={phoneCapture} />
      {hasSelection && (
        <button
          onClick={onDelete}
          className="bg-white border border-gray-300 rounded-md p-2 shadow-sm hover:bg-red-50 hover:border-red-300 transition-colors"
          title="Delete selected items"
        >
          <FaTrash className="w-4 h-4 text-red-600" />
        </button>
      )}
    </div>
  );
});

const SidebarToggleButton = memo(function SidebarToggleButton({
  isSidebarExpanded,
  setIsSidebarExpanded,
}: {
  isSidebarExpanded: boolean;
  setIsSidebarExpanded: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <button
      onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
      className="absolute top-4 right-4 z-10 bg-white border border-gray-300 rounded-md p-2 shadow-sm hover:bg-gray-50 transition-colors"
    >
      {isSidebarExpanded ? (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      ) : (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
      )}
    </button>
  );
});

// Saved-example links at the bottom of the Components panel. Clicking one
// replaces the current graph with that example (after a confirm).
const ExamplesSection = memo(function ExamplesSection({
  loadFlow,
  searchQuery,
}: {
  loadFlow: (flow: Flow) => void;
  searchQuery: string;
}) {
  const filtered = useMemo(
    () =>
      searchQuery
        ? examples.filter((ex) => ex.name.toLowerCase().includes(searchQuery))
        : examples,
    [searchQuery],
  );

  if (filtered.length === 0) return null;

  return (
    <div className="my-4">
      <h4 className="text-sm text-gray-600 mb-2 font-bold">Examples</h4>
      <div className="flex flex-col gap-0.5">
        {filtered.map((ex) => (
          <button
            key={ex.id}
            onClick={() => {
              if (
                window.confirm(
                  `Load “${ex.name}”? This replaces your current program.`,
                )
              ) {
                loadFlow(ex.flow);
              }
            }}
            className="text-left px-2 py-1.5 rounded-md text-sm text-blue-700 hover:bg-blue-50 hover:text-blue-800 transition-colors"
          >
            {ex.name}
          </button>
        ))}
      </div>
    </div>
  );
});

const Sidebar = memo(
  ({
    isSidebarExpanded,
    setDraggedOpId,
    loadFlow,
    ctx,
  }: {
    isSidebarExpanded: boolean;
    setDraggedOpId: Dispatch<SetStateAction<AnyOpId | null>>;
    loadFlow: (flow: Flow) => void;
    ctx: OmniCanvasContextType;
  }) => {
    const onDragStart = useCallback(
      (event: React.DragEvent, opId: AnyOpId) => {
        setDraggedOpId(opId);
        event.dataTransfer.setData("text/plain", opId);
        event.dataTransfer.effectAllowed = "move";
      },
      [setDraggedOpId],
    );

    const [searchInput, setSearchInput] = useState("");
    const searchQuery = useMemo(
      () => searchInput.toLowerCase().trim(),
      [searchInput],
    );

    useEffect(() => {
      if (!isSidebarExpanded) {
        setSearchInput("");
      }
    }, [isSidebarExpanded]);

    const renderOpWrapper = useCallback(
      (opId: AnyOpId, children: React.ReactNode) => (
        <div
          draggable
          onDragStart={(event) => onDragStart(event, opId)}
          className="p-3 bg-white border border-gray-300 rounded-lg cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-sm transition-all select-none [&>*]:pointer-events-none"
        >
          {children}
        </div>
      ),
      [onDragStart],
    );

    const [searchInputDiv, setSearchInputDiv] =
      useState<HTMLInputElement | null>(null);
    useEffect(() => {
      if (isSidebarExpanded && searchInputDiv) {
        searchInputDiv.focus({ preventScroll: true });
      }
    }, [isSidebarExpanded, searchInputDiv]);

    const transition = clsx("transition-all duration-300 ease-in-out");

    return (
      <>
        {/* this guy takes up the room */}
        <div className={clsx(isSidebarExpanded ? "w-72" : "w-0", transition)} />
        {/* we position the overlay separately, and staticly (for perf) */}
        <OmniCanvasOverlay className="absolute top-0 right-0 bottom-0 w-72 pointer-events-none">
          {/* Clip the slide so the collapsed (translate-x-full) panel stays
              hidden within this 72-wide box instead of spilling to the right —
              important in split mode, where "to the right" is the preview. */}
          <div className="w-full h-full overflow-hidden pointer-events-none">
            {/* this part slides in & out */}
            <div
              className={clsx(
                isSidebarExpanded ? "translate-x-0" : "translate-x-full",
                transition,
                "bg-gray-50 border-l border-gray-200 pt-4 px-4 h-full flex flex-col pointer-events-auto",
              )}
            >
              <h3 className="text-lg font-semibold text-gray-800">
                Components
              </h3>
              <TextField.Root
                ref={setSearchInputDiv}
                className="mt-2 mb-4 shrink-0"
                placeholder="Search for a component…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              >
                <TextField.Slot>
                  <FaMagnifyingGlass className="w-3 h-3 text-gray-500" />
                </TextField.Slot>
                {searchInput && (
                  <TextField.Slot>
                    <button onClick={() => setSearchInput("")}>
                      <FaX className="w-3 h-3 text-gray-500" />
                    </button>
                  </TextField.Slot>
                )}
              </TextField.Root>
              <div className="overflow-auto flex flex-col">
                <OpList
                  opsInGroups={putOpsIntoGroups(ops)}
                  searchQuery={searchQuery}
                  renderOpWrapper={renderOpWrapper}
                  InputHandle={InputHandle}
                  OutputHandle={OutputHandle}
                  groupClassName="my-4"
                  groupHeadingClassName="text-sm text-gray-600 mb-2 font-bold"
                  gapClassName="gap-2"
                />
                <ExamplesSection
                  loadFlow={loadFlow}
                  searchQuery={searchQuery}
                />
              </div>
            </div>
          </div>
        </OmniCanvasOverlay>
      </>
    );
  },
);
