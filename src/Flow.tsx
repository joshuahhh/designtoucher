import { up } from "@engraft/update-proxy";
import { Theme } from "@radix-ui/themes";
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
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  Viewport,
} from "@xyflow/react";
import { clsx } from "clsx";
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FaExpandArrowsAlt, FaTrash } from "react-icons/fa";
import "./flow-base.css";
import { getHandleClasses } from "./Handles.js";
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
  FlowContext,
  getOpId,
  makeOutputHandleId,
  parseInputHandleId,
  PhonyContext,
  SentenceHandle,
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
// import "./xy-theme.css";

const VideoOutputHandle = ({
  nodeId,
  tex,
}: {
  nodeId: string;
  tex: Tex | null | undefined;
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleFullscreenClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFullscreen(true);
    setIsHovered(false);
  }, []);

  return (
    <div
      style={{ width: 200 }}
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Handle
        type="source"
        position={Position.Bottom}
        // TODO: customize
        id={makeOutputHandleId(nodeId, "out")}
        className={clsx(getHandleClasses(true), { "border-dashed": !tex })}
      >
        {tex ? (
          <Monitor tex={tex} />
        ) : (
          <div
            style={{
              width: 200,
              aspectRatio: "1.77778 / 1",
            }}
          />
        )}
        {tex && isHovered && !isFullscreen && (
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
      {isFullscreen && tex && (
        <FullscreenModal
          tex={tex}
          onClose={() => {
            setIsFullscreen(false);
          }}
        />
      )}
    </div>
  );
};

export function OpNodeView(props: NodeProps<OpNode>) {
  const [data, setData] = useNodeData(props);
  const dataUP = up(setData);

  const { selected } = props;

  // useEffect(() => {
  //   console.log("OpNodeView mounted", props.id);
  //   return () => {
  //     console.log("OpNodeView unmounted", props.id);
  //   };
  // }, [props.id]);

  const { opInstances } = useContext(FlowContext);

  const op = opById(data.opId);
  const runtime = opInstances[props.id]?.runtime;

  if (!runtime) {
    return null;
  }

  // const updateNodeInternals = useUpdateNodeInternals();
  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     // console.log("Updating node internals for", props.id);
  //     updateNodeInternals(props.id);
  //   }, 1000);
  //   return () => clearInterval(interval);
  // }, [props.id, updateNodeInternals]);

  if (!runtime) {
    return null;
  }

  // TODO: customize this
  const output = (runtime as any).out;

  return (
    <div
      className={clsx(
        "flex flex-col items-center border rounded-md bg-gray-100 p-2 !-z-10 transition-all duration-100",
        selected
          ? [
              "border-blue-400 border-2",
              "shadow-lg shadow-blue-200/20",
              "ring-1 ring-blue-300/15",
            ]
          : ["border-gray-300", "hover:border-blue-300 hover:shadow-sm"],
      )}
    >
      {/* <NodeResizer
        color="#ff0071"
        isVisible={selected}
        minWidth={100}
        minHeight={30}
      /> */}
      <op.RenderTop
        params={data.params}
        paramsUP={dataUP.params}
        runtime={runtime}
        Handle={SentenceHandle}
      />
      <div className="operation-node-body relative mt-1">
        <VideoOutputHandle nodeId={props.id} tex={output} />
      </div>
    </div>
  );
}

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
  const { screenToFlowPosition } = useReactFlow();

  const flowUP = up(setFlow);

  const [viewport, setViewport] = useLocalStorage<Viewport>("viewport", () => ({
    x: 100,
    y: 100,
    zoom: 2,
  }));

  const [opInstances, setOpInstances] = useState<Record<string, AnyOpInstance>>(
    {},
  );
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

  const flowRef = useRefForCallback(flow);
  const opInstancesRef = useRefForCallback(opInstances);

  useEffect(() => {
    return animate(() => {
      // run the flow
      // console.log("Running flow");
      runFlow(
        flowRef.current.nodes,
        flowRef.current.edges,
        opInstances,
        ctx,
        (nodeId, params) => {
          flowUP.nodes.$all
            .$if((n) => n.id === nodeId)
            .data.params.$set(params);
        },
      );
      setOpInstances((prevRuntimes) => ({ ...prevRuntimes }));
    });
  }, [flowRef, opInstances, ctx, flowUP]);

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
              setOpInstances({});
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
    [screenToFlowPosition, draggedOpId, flowUP.nodes],
  );

  useKeyBindings([
    {
      combo: "c+r",
      action: () => {
        setOpInstances({});
      },
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

  return (
    <div className="w-full h-full flex">
      <div className="flex-1 relative">
        <FlowContext.Provider value={{ opInstances: opInstancesRef.current }}>
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges.map((e) => {
              // TODO: we should prob make a custom edge at some point
              const { nodeId, key } = parseInputHandleId(e.targetHandle!);
              const node = flow.nodes.find((n) => n.id === nodeId);
              const op = node ? opById(node.data.opId) : null;
              const isLate = op?.inputKeysLate?.includes(key);
              return {
                ...e,
                className: clsx({ "[stroke-dasharray:5,5]": isLate }),
              };
            })}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
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
            <MiniMap zoomable pannable />
            <Controls />
            <Background />
            <CopyPaste />
          </ReactFlow>
        </FlowContext.Provider>

        <SidebarToggleButton
          isSidebarExpanded={isSidebarExpanded}
          setIsSidebarExpanded={setIsSidebarExpanded}
        />

        <Toolbar onDelete={deleteSelected} />
      </div>
      <Sidebar
        isSidebarExpanded={isSidebarExpanded}
        setDraggedOpId={setDraggedOpId}
        ctx={ctx}
      />
    </div>
  );
};

const Toolbar = ({ onDelete }: { onDelete: () => void }) => {
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
};

const SidebarToggleButton = ({
  isSidebarExpanded,
  setIsSidebarExpanded,
}: {
  isSidebarExpanded: boolean;
  setIsSidebarExpanded: Dispatch<SetStateAction<boolean>>;
}) => {
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
};

const Sidebar = ({
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

  const noopParamsUP = useMemo(() => up<Record<string, any>>(() => {}), []);
  const paramsByOp = useMemo(() => {
    return Object.fromEntries(
      ops.map((op) => [op.id, op.initParams?.() ?? {}]),
    );
  }, []);

  return (
    <PhonyContext.Provider value={{ phony: true }}>
      <div
        className={`transition-all duration-300 ease-in-out bg-gray-50 border-l border-gray-200 ${
          isSidebarExpanded ? "w-72 opacity-100" : "w-0 opacity-0"
        } overflow-hidden z-[2]`}
      >
        <div className="pt-4 px-4 h-full flex flex-col">
          <h3 className="text-lg font-semibold text-gray-800">Components</h3>
          <div className="overflow-auto">
            {opsInGroups.map(([groupName, groupOps]) => (
              <div key={groupName} className="my-8">
                <h4 className="text-sm text-gray-600 mb-2 font-bold">
                  {groupName}
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {groupOps.map((op) => (
                    <div
                      key={op.id}
                      draggable
                      onDragStart={(event) => onDragStart(event, getOpId(op))}
                      className="p-3 bg-white border border-gray-300 rounded-lg cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-sm transition-all select-none [&>*]:pointer-events-none"
                    >
                      <op.RenderTop
                        runtime={null}
                        paramsUP={noopParamsUP}
                        params={paramsByOp[op.id]}
                        Handle={SentenceHandle}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PhonyContext.Provider>
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
