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
  MiniMap,
  Node,
  NodeChange,
  NodeProps,
  NodeTypes,
  OnConnectEnd,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  Viewport,
} from "@xyflow/react";
import { clsx } from "clsx";
import {
  Dispatch,
  memo,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  OpInstancesContext,
  OutputHandle,
  parseInputHandleId,
  parseOutputHandleId,
  SetFullscreenModalTexContext,
} from "./ops-core.js";
import { opById, OpNode, runFlow } from "./ops-flow.js";
import { ops, opsInGroups } from "./ops/all-the-ops.js";
import {
  CopyPaste,
  useNodeData,
  useReactFlowSelection,
} from "./react-flow-util.js";
import { useLocalStorage } from "./useLocalStorage.js";
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
        "flex flex-col gap-1 items-center border rounded-md bg-gray-100 p-2 !-z-10 transition-all duration-100",
        selected
          ? [
              "border-blue-400 border-2",
              "shadow-lg shadow-blue-200/20",
              "ring-1 ring-blue-300/15",
            ]
          : ["border-gray-300", "hover:border-blue-300 hover:shadow-sm"],
      )}
    >
      <instance.Render params={data.params} paramsUP={dataUP.params} />
    </div>
  );
});

const nodeTypes: NodeTypes = {
  operation: OpNodeView,
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

export type Flow = {
  nodes: OpNode[];
  edges: Edge[];
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
      // run the flow
      // console.log("Running flow");
      runFlow(
        flowRef.current.nodes,
        flowRef.current.edges,
        opInstancesRef.current,
        ctx,
        (nodeId, params) => {
          flowUP.nodes.$all
            .$if((n) => n.id === nodeId)
            .data.params.$set(params);
        },
      );
      // TODO: some render functions like "camera" need this cuz they
      // don't know when their runtime updates – we should either
      // come up with a more deliberate channel, or accept that nodes
      // are gonna rerender every tick
      setOpInstances((prevRuntimes) => ({ ...prevRuntimes }));
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
  const { screenToFlowPosition } = useReactFlow();

  const flowUP = up(setFlow);

  const [viewport, setViewport] = useLocalStorage<Viewport>("viewport", () => ({
    x: 100,
    y: 100,
    zoom: 2,
  }));

  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [draggedOpId, setDraggedOpId] = useState<AnyOpId | null>(null);

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

  const onConnect = useCallback(
    (params: Connection) => {
      flowUP.edges.$((edges) =>
        addEdge(
          params,
          edges.filter((e) => {
            return !(
              e.target === params.target &&
              e.targetHandle === params.targetHandle
            );
          }),
        ),
      );
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

      const { from, fromHandle } = connectionState;
      if (!from || !fromHandle?.id) return;
      let parsedAsOutput;
      try {
        parsedAsOutput = parseOutputHandleId(fromHandle.id);
      } catch {
        return;
      }

      const { clientX, clientY } =
        "changedTouches" in event ? event.changedTouches[0] : event;
      const newNode: OpCreationNode = {
        id: getId(),
        position: screenToFlowPosition({
          x: clientX,
          y: clientY,
        }),
        data: {},
        origin: [0.5, 0.0],
      };

      // flowUP.nodes.$((nodes) => [...nodes, newNode]);
      // flowUP.edges.$((edges) =>
      //   addEdge({ source: from.id, target: newNode.id }, edges),
      // );
    },
    [screenToFlowPosition],
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
  const { getNodes, getEdges, deleteElements } = useReactFlow();

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
        const op = node ? opById(node.data.opId) : null;
        const isLate = op?.inputKeysLate?.includes(key);
        return {
          ...e,
          className: clsx({ "[stroke-dasharray:5,5]": isLate }),
        };
      }),
    [flow.edges, flow.nodes],
  );

  return (
    <div className="w-full h-full flex">
      <div className="flex-1 relative">
        <ReactFlow
          nodes={flow.nodes}
          edges={styledEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          nodeTypes={nodeTypes}
          maxZoom={10}
          minZoom={0.1}
          viewport={viewport}
          onViewportChange={setViewport}
          onDragOver={onDragOver}
          onDrop={onDrop}
          nodeOrigin={[0.5, 0.5]}
          className="[--xy-edge-stroke-default:#000] [--xy-edge-stroke-selected:theme(colors.blue.500)]"
          onPaneClick={onPaneClick}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <OmniCanvasOverlay className="absolute top-0 left-0 w-full h-full">
            <MiniMap zoomable pannable />
            <Controls className="bg-gray-50" />
            <CopyPaste />
            <SidebarToggleButton
              isSidebarExpanded={isSidebarExpanded}
              setIsSidebarExpanded={setIsSidebarExpanded}
            />
            <Toolbar onDelete={deleteSelected} />
          </OmniCanvasOverlay>
        </ReactFlow>
      </div>
      <Sidebar
        isSidebarExpanded={isSidebarExpanded}
        setDraggedOpId={setDraggedOpId}
        ctx={ctx}
      />
    </div>
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
        <OmniCanvasOverlay className="absolute top-0 right-0 bottom-0 w-72">
          {/* this part slides in & out */}
          <div
            className={clsx(
              isSidebarExpanded ? "translate-x-0" : "translate-x-full",
              transition,
              "bg-gray-50 border-l border-gray-200 pt-4 px-4 h-full flex flex-col",
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
                                hidden:
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
