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
import {
  createContext,
  Dispatch,
  memo,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FaLightbulb, FaTrash } from "react-icons/fa";
import { FaMagnifyingGlass, FaX } from "react-icons/fa6";
import { up } from "update-proxy";
import "./flow-base.css";
import { HighlightMatches } from "./HighlightMatches.js";
import { useKeyBindings } from "./keyboard.js";
import { Tex } from "./mygl.js";
import {
  Monitor,
  OmniCanvasContext,
  OmniCanvasContextType,
  OmniCanvasHost,
  OmniCanvasOverlay,
} from "./OmniCanvas.js";
import {
  AnyOpId,
  AnyOpInstance,
  getOpId,
  InputHandle,
  makeInputHandleId,
  makeOutputHandleId,
  OpInstancesContext,
  OutputHandle,
  parseInputHandleId,
  parseOutputHandleId,
  SetFullscreenModalTexContext,
  sharedHandleClasses,
} from "./ops-core.js";
import { opById, OpNode, runFlow } from "./ops-flow.js";
import { ops, opsInGroups } from "./ops/all-the-ops.js";
import {
  CopyPaste,
  useNodeData,
  useReactFlowSelection,
} from "./react-flow-util.js";
import { getTransitiveDownstream, getTransitiveUpstream } from "./toposort.js";
import { useRefForCallback } from "./useRefForCallback.js";
import { animate } from "./util.js";

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

  const noopParamsUP = useMemo(() => up<Record<string, unknown>>(() => {}), []);
  const paramsByOp = useMemo(
    () => Object.fromEntries(ops.map((op) => [op.id, op.initParams?.() ?? {}])),
    [],
  );

  // Only show ops that have enough inputs/outputs for the number of connections
  const applicableOpsInGroups = useMemo(
    () =>
      opsInGroups
        .map(
          ([groupName, groupOps]) =>
            [
              groupName,
              groupOps.filter((op) =>
                isOutput
                  ? (op.outputKeys ?? ["out"]).length >= connectionCount
                  : (op.inputKeys?.length ?? 0) +
                      (op.inputKeysLate?.length ?? 0) >=
                    connectionCount,
              ),
            ] as [string, typeof groupOps],
        )
        .filter(([, groupOps]) => groupOps.length > 0),
    [connectionCount, isOutput],
  );

  const [opHasMatch, setOpHasMatch] = useState<Record<string, boolean>>({});

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
        {applicableOpsInGroups.map(([groupName, groupOps]) => (
          <div
            key={groupName}
            className={clsx("mb-3", {
              hidden: searchQuery && !groupOps.some((op) => opHasMatch[op.id]),
            })}
          >
            <h4 className="text-xs text-gray-500 font-bold mb-1 px-1">
              {groupName}
            </h4>
            <div className="flex flex-col gap-1">
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
                  className={clsx({
                    hidden: searchQuery && !opHasMatch[op.id],
                  })}
                >
                  <div
                    onClick={() => transformPicker(props.id, getOpId(op))}
                    className="w-full text-left p-2 bg-white border border-gray-200 rounded-md cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all [&>*]:pointer-events-none"
                  >
                    <op.Render
                      runtime={null}
                      paramsUP={noopParamsUP}
                      params={paramsByOp[op.id]}
                      InputHandle={StubInputHandle}
                      OutputHandle={StubOutputHandle}
                    />
                  </div>
                </HighlightMatches>
              ))}
            </div>
          </div>
        ))}
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
}: {
  flow: Flow;
  setFlow: Dispatch<SetStateAction<Flow>>;
}) => (
  <div className="flex w-full h-full overflow-hidden box-border relative">
    <ReactFlowProvider>
      <OmniCanvasHost>
        {/* !min-h-[initial] is to override some default radix-theme thing that uses dvh and messes up height on ipad (!!!) */}
        <Theme appearance="light" className="w-full h-full !min-h-[initial]">
          <FlowInner flow={flow} setFlow={setFlow} />
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

const FlowInner = ({
  flow,
  setFlow,
}: {
  flow: Flow;
  setFlow: Dispatch<SetStateAction<Flow>>;
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

  const [fullscreenModalTex, setFullscreenModalTex] = useState<Tex | null>(
    null,
  );

  const resetOpInstances = useCallback(() => {
    setOpInstances({});
  }, []);

  return (
    <SetFullscreenModalTexContext.Provider value={setFullscreenModalTex}>
      <OpInstancesContext.Provider value={opInstances}>
        {fullscreenModalTex ? (
          <FullscreenModal tex={fullscreenModalTex} />
        ) : (
          <FlowInnerNormalMode
            flow={flow}
            setFlow={setFlow}
            resetOpInstances={resetOpInstances}
          />
        )}
      </OpInstancesContext.Provider>
    </SetFullscreenModalTexContext.Provider>
  );
};

export const FullscreenModal = ({ tex }: { tex: Tex }) => {
  const { underlayDiv } = useContext(OmniCanvasContext);
  const setFullscreenModalTex = useContext(SetFullscreenModalTexContext);

  const close = useCallback(
    () => setFullscreenModalTex(null),
    [setFullscreenModalTex],
  );

  useKeyBindings([
    {
      combo: "Escape",
      action: close,
    },
  ]);

  const aspectRatio = tex.width / tex.height;

  return createPortal(
    <div className="fixed inset-0 bg-black grid place-items-center [container-type:size]">
      <OmniCanvasOverlay className="absolute inset-0">
        <button
          onClick={close}
          className="absolute top-4 right-4 text-white hover:text-gray-300 z-10 pointer-events-auto"
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
        <Monitor tex={tex} checkerboardPixels={100} />
      </div>
    </div>,
    underlayDiv,
  );
};

const FlowInnerNormalMode = ({
  flow,
  setFlow,
  resetOpInstances,
}: {
  flow: Flow;
  setFlow: Dispatch<SetStateAction<Flow>>;
  resetOpInstances: () => void;
}) => {
  const ctx = useContext(OmniCanvasContext);
  const { screenToFlowPosition, getNodes } = useReactFlow();

  const flowUP = up(setFlow);

  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [draggedOpId, setDraggedOpId] = useState<AnyOpId | null>(null);

  const transformPicker = useCallback(
    (nodeId: string, opId: AnyOpId) => {
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
    [flow.nodes, flowUP.nodes, flowUP.edges],
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

  const onNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: Node) => {
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

  const onNodeDragStop = useCallback(() => {
    groupDragRef.current = null;
  }, []);

  const onConnect = useCallback(
    (params: Connection) => {
      // All handles accept multiple connections (multi-edges get implicitly summed).
      flowUP.edges.$((edges) => addEdge(params, edges));
    },
    [flowUP.edges],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

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
              resetOpInstances();
              setFlow(data);
            } catch (err) {
              console.error("Failed to load flow from file", err);
            }
          };
          reader.readAsText(file);
        }
        return;
      }

      if (!draggedOpId) return;

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
    [
      draggedOpId,
      screenToFlowPosition,
      flowUP.nodes,
      resetOpInstances,
      setFlow,
    ],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (connectionState.isValid) return;

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

      const { clientX, clientY } =
        "changedTouches" in event ? event.changedTouches[0] : event;

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
    },
    [screenToFlowPosition, flowUP.nodes, flowUP.edges, getNodes],
  );

  useKeyBindings([
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

  const store = useStoreApi();
  const { getEdges, deleteElements } = useReactFlow();

  const onPaneClick = useCallback(() => {
    store.setState({ connectionClickStartHandle: null });
  }, [store]);

  const deleteSelected = useCallback(() => {
    const selectedNodes = getNodes().filter((node) => node.selected);
    const selectedEdges = getEdges().filter((edge) => edge.selected);

    deleteElements({ nodes: selectedNodes, edges: selectedEdges });
  }, [getNodes, getEdges, deleteElements]);

  const styledEdges = useMemo(
    () =>
      flow.edges.map((e) => {
        // TODO: we should prob make a custom edge at some point
        const { nodeId, key } = parseInputHandleId(e.targetHandle!);
        const node = flow.nodes.find((n) => n.id === nodeId);
        const op = node?.type === "operation" ? opById(node.data.opId) : null;
        const isLate = op?.inputKeysLate?.includes(key);
        return {
          ...e,
          className: clsx({ "[stroke-dasharray:5,5]": isLate }),
        };
      }),
    [flow.edges, flow.nodes],
  );

  return (
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
                <CopyPaste />
                <SidebarToggleButton
                  isSidebarExpanded={isSidebarExpanded}
                  setIsSidebarExpanded={setIsSidebarExpanded}
                />
                <Toolbar onDelete={deleteSelected} />
              </div>
            </OmniCanvasOverlay>
          </ReactFlow>
        </div>
        <Sidebar
          isSidebarExpanded={isSidebarExpanded}
          setDraggedOpId={setDraggedOpId}
          ctx={ctx}
        />
      </div>
    </TransformPickerContext.Provider>
  );
};

const Toolbar = memo(function Toolbar({ onDelete }: { onDelete: () => void }) {
  const { selectedNodes, selectedEdges } = useReactFlowSelection<Node, Edge>();
  const hasSelection = selectedNodes.length > 0 || selectedEdges.length > 0;

  // const isMultiTouch =
  //   navigator.maxTouchPoints !== undefined && navigator.maxTouchPoints > 1;

  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 select-none">
      {/* {isMultiTouch && (
        <button
          className="bg-white border border-gray-300 rounded-md p-2 shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-colors"
          title="Lasso selection on hold"
          onPointerDown={onLassoPointerDown}
          onPointerUp={onLassoPointerUp}
        >
          <LuLasso className="w-4 h-4 text-grey-600" />
        </button>
      )} */}

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

const Sidebar = memo(
  ({
    isSidebarExpanded,
    setDraggedOpId,
    ctx,
  }: {
    isSidebarExpanded: boolean;
    setDraggedOpId: Dispatch<SetStateAction<AnyOpId | null>>;
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

    const noopParamsUP = useMemo(
      () => up<Record<string, unknown>>(() => {}),
      [],
    );
    const paramsByOp = useMemo(() => {
      return Object.fromEntries(
        ops.map((op) => [op.id, op.initParams?.() ?? {}]),
      );
    }, []);

    const [searchInput, setSearchInput] = useState("");
    const searchQuery = useMemo(
      () => searchInput.toLowerCase().trim(),
      [searchInput],
    );

    const [opHasMatch, setOpHasMatch] = useState<Record<string, boolean>>({});

    useEffect(() => {
      if (!isSidebarExpanded) {
        setSearchInput("");
        setOpHasMatch({});
      }
    }, [isSidebarExpanded]);

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
          {/* this part slides in & out */}
          <div
            className={clsx(
              isSidebarExpanded ? "translate-x-0" : "translate-x-full",
              transition,
              "bg-gray-50 border-l border-gray-200 pt-4 px-4 h-full flex flex-col pointer-events-auto",
            )}
          >
            <h3 className="text-lg font-semibold text-gray-800">Components</h3>
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
              {opsInGroups.map(([groupName, groupOps]) => (
                <div
                  key={groupName}
                  className={clsx("my-4", {
                    hidden:
                      searchQuery && !groupOps.some((op) => opHasMatch[op.id]),
                  })}
                >
                  <h4 className="text-sm text-gray-600 mb-2 font-bold">
                    {groupName}
                  </h4>
                  <div className="flex flex-col gap-2">
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
                        <div
                          draggable
                          onDragStart={(event) =>
                            onDragStart(event, getOpId(op))
                          }
                          className="p-3 bg-white border border-gray-300 rounded-lg cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-sm transition-all select-none [&>*]:pointer-events-none"
                        >
                          <op.Render
                            runtime={null}
                            paramsUP={noopParamsUP}
                            params={paramsByOp[op.id]}
                            InputHandle={InputHandle}
                            OutputHandle={OutputHandle}
                          />
                        </div>
                        {(op.searchHints ?? []).map((hint, i) => (
                          <div
                            key={i}
                            className={clsx(
                              {
                                "!hidden":
                                  !searchQuery ||
                                  !hint.toLowerCase().includes(searchQuery),
                              },
                              "text-xs text-gray-500 mt-2 ml-4 flex gap-2",
                            )}
                          >
                            <FaLightbulb className="inline-block shrink-0" />{" "}
                            {hint}
                          </div>
                        ))}
                      </HighlightMatches>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </OmniCanvasOverlay>
      </>
    );
  },
);
