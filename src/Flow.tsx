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
  useUpdateNodeInternals,
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
import { assertNever } from "./assert.js";
import "./flow-base.css";
import {
  AnyOpId,
  BaseOp,
  FlowContext,
  idxToOutputHandle,
  opById,
  OpNode,
  OpNodeData,
  OpParam,
  opsInGroups,
  runFlow,
} from "./flow-lib.js";
import { getHandleClasses } from "./Handles.js";
import { Tex } from "./mygl.js";
import {
  Monitor,
  OmniCanvasContext,
  OmniCanvasContextType,
  OmniCanvasGuest,
  OmniCanvasHost,
  OmniCanvasOverlay,
} from "./OmniCanvas.js";
import { CopyPaste, useNodeData } from "./react-flow-util.js";
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
        id={idxToOutputHandle(0)}
        className={clsx(getHandleClasses(true), { "border-dashed": !tex })}
      >
        {tex ? (
          <Monitor tex={tex} className="pointer-events-none" />
        ) : (
          <div
            style={{
              width: 200,
              aspectRatio: "1.77778 / 1",
            }}
          />
        )}
        {tex && isHovered && !isFullscreen && (
          <OmniCanvasOverlay className="absolute left-0 top-0 w-full h-full">
            <button
              onClick={handleFullscreenClick}
              className="absolute top-1 right-1 bg-black/70 text-white p-1 rounded hover:bg-black/90 transition-colors pointer-events-auto z-10"
              title="View fullscreen"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
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

  const { runtimes } = useContext(FlowContext);

  const opClass = opById(data.opId);
  const runtime = runtimes[props.id];

  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const interval = setInterval(() => {
      // console.log("Updating node internals for", props.id);
      updateNodeInternals(props.id);
    }, 1000);
    return () => clearInterval(interval);
  }, [props.id, updateNodeInternals]);

  if (!runtime) {
    return null;
  }

  const outputs = runtime.outputs;

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
      {runtime.renderTop?.({
        paramValues: data.paramValues,
        paramValuesUP: dataUP.paramValues,
        instance: runtime,
        phony: false,
      }) ?? <div className="above">{opClass.id}</div>}
      <div className="operation-node-body relative mt-1">
        <VideoOutputHandle nodeId={props.id} tex={outputs[0]} />
      </div>
    </div>
  );
}

const Param = (props: {
  param: OpParam;
  data: OpNodeData;
  setData: Dispatch<SetStateAction<OpNodeData>>;
}) => {
  const { param, data, setData } = props;
  const value = data.paramValues[param.varName];

  const [automate, setAutomate] = useState<false | number>(false);
  const automateRef = useRefForCallback(automate);

  useEffect(() => {
    return animate(() => {
      setData((data) => {
        if (!automateRef.current || param.type !== "number") return data;

        const value = data.paramValues[param.varName];
        const newValue = value + param.step * automateRef.current;
        if (newValue <= param.min || newValue >= param.max) {
          setAutomate(-automateRef.current);
        }

        return {
          ...data,
          paramValues: {
            ...data.paramValues,
            [param.varName]: newValue,
          },
        };
      });
    });
  }, [automateRef, param, setData]);

  if (param.type === "number") {
    return (
      <div
        key={param.varName}
        className="operation-node-param flex gap-1 group"
      >
        <label className="operation-node-param-label">
          {param.displayName}
        </label>
        <input
          className="nodrag w-20"
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={value}
          onChange={(e) => {
            setData((data) => ({
              ...data,
              paramValues: {
                ...data.paramValues,
                [param.varName]: Number(e.target.value),
              },
            }));
          }}
        />
        <span className="operation-node-param-value">
          {Number(value).toFixed(2)}
        </span>
        <span
          className={`ml-2 ${automate ? "" : "group-hover:visible invisible"}`}
        >
          <input
            className="nodrag ml-2"
            type="checkbox"
            checked={automate !== false}
            onChange={(e) => setAutomate(e.target.checked ? 1 : false)}
          />
          ⌛
        </span>
      </div>
    );
  } else if (param.type === "string") {
    return (
      <div
        key={param.varName}
        className="operation-node-param flex flex-col gap-1"
      >
        <label className="operation-node-param-label">
          {param.displayName}
        </label>
        <textarea
          className="nodrag nocopypaste max-w-full font-mono"
          style={{ fontSize: "0.5rem" }}
          value={value}
          onChange={(e) => {
            setData((data) => ({
              ...data,
              paramValues: {
                ...data.paramValues,
                [param.varName]: e.target.value,
              },
            }));
          }}
        />
      </div>
    );
  } else if (param.type === "boolean") {
    return (
      <div key={param.varName} className="operation-node-param flex gap-1">
        <label className="operation-node-param-label">
          {param.displayName}
        </label>
        <input
          className="nodrag"
          type="checkbox"
          checked={value}
          onChange={(e) => {
            setData((data) => ({
              ...data,
              paramValues: {
                ...data.paramValues,
                [param.varName]: e.target.checked,
              },
            }));
          }}
        />
      </div>
    );
  } else {
    assertNever(param, `Unknown param type: ${(param as any).type}`);
  }
};

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
  <div className="flex w-full h-full overflow-hidden box-border">
    <ReactFlowProvider>
      <OmniCanvasHost>
        <Theme appearance="light" className="w-full h-full">
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

  const [runtimes, setRuntimes] = useState<Record<string, BaseOp>>({});
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
  const runtimesRef = useRefForCallback(runtimes);

  useEffect(() => {
    return animate(() => {
      // run the flow
      // console.log("Running flow");
      runFlow(flowRef.current.nodes, flowRef.current.edges, runtimes, ctx);
      setRuntimes((prevRuntimes) => ({ ...prevRuntimes }));
    });
  }, [flowRef, runtimes, ctx]);

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

      if (!draggedOpId) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: OpNode = {
        id: getId(),
        type: "operation",
        position,
        data: {
          opId: draggedOpId,
          paramValues: {},
        },
      };

      flowUP.nodes.$((nodes) => [...nodes, newNode]);
      setDraggedOpId(null);
    },
    [screenToFlowPosition, draggedOpId, flowUP.nodes],
  );

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "r") {
        setRuntimes({});
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, []);

  const store = useStoreApi();

  const onPaneClick = useCallback(() => {
    store.setState({ connectionClickStartHandle: null });
  }, [store]);

  return (
    <div className="w-full h-full flex">
      <div className="flex-1 relative">
        <FlowContext.Provider value={{ runtimes: runtimesRef.current }}>
          <ReactFlow
            attributionPosition="top-right"
            nodes={flow.nodes}
            edges={flow.edges}
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
      </div>
      <Sidebar
        isSidebarExpanded={isSidebarExpanded}
        setDraggedOpId={setDraggedOpId}
        ctx={ctx}
      />
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

  const instantiatedOps = useMemo(
    () =>
      Object.fromEntries(
        opsInGroups.flatMap(([groupName, groupOps]) =>
          groupOps.map((opClass) => {
            const op = new opClass(ctx, undefined as any);
            return [opClass.id, op];
          }),
        ),
      ),
    [ctx],
  );

  const noopParamValuesUP = useMemo(
    () => up<Record<string, any>>(() => {}),
    [],
  );
  const noopParamValues = useMemo(() => ({}), []);

  return (
    <div
      className={`transition-all duration-300 ease-in-out bg-gray-50 border-l border-gray-200 ${
        isSidebarExpanded ? "w-60 opacity-100" : "w-0 opacity-0"
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
                {groupOps.map((opClass) => {
                  const op = instantiatedOps[opClass.id];

                  if (!op.renderTop) {
                    return null; // Skip if no renderTop method
                  }

                  return (
                    <div
                      key={opClass.id}
                      draggable
                      onDragStart={(event) => onDragStart(event, opClass.id)}
                      className="p-3 bg-white border border-gray-300 rounded-lg cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-sm transition-all select-none"
                    >
                      {op.renderTop?.({
                        instance: op,
                        paramValuesUP: noopParamValuesUP,
                        paramValues: noopParamValues,
                        phony: true,
                      })}
                    </div>
                  );
                  // <div
                  //   key={op.id}
                  //   draggable
                  //   onDragStart={(event) => onDragStart(event, op.id)}
                  //   className="p-3 bg-white border border-gray-300 rounded-lg cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-sm transition-all select-none"
                  // >
                  //   <div className="font-medium text-gray-900">{op.id}</div>
                  //   <div className="text-xs text-gray-500 mt-1">
                  //     {op.description}
                  //   </div>
                  // </div>
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const FullscreenModal = ({
  tex,
  onClose,
}: {
  tex: Tex;
  onClose: () => void;
}) => {
  const { underlayDiv, draw } = useContext(OmniCanvasContext);

  const command = useCallback(
    (viewport: [number, number, number, number]) => {
      draw({ texture: tex.texture, viewport });
    },
    [draw, tex.texture],
  );

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [onClose]);

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

      <OmniCanvasGuest
        command={command}
        className={`bg-gray-300`}
        style={{
          width: `min(100cqw,calc(100cqh*${aspectRatio}))`,
          aspectRatio: aspectRatio,
        }}
      />
    </div>,
    underlayDiv,
  );
};
