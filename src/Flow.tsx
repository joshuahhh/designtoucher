import { up } from "@engraft/update-proxy";
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
  useUpdateNodeInternals,
  Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { clsx } from "clsx";
import {
  createContext,
  Dispatch,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { assertNever } from "./assert.js";
import {
  AnyOpId,
  BaseOp,
  idxToOutputHandle,
  opById,
  OpNode,
  OpNodeData,
  OpParam,
  opsInGroups,
  runFlow,
} from "./flow-lib.js";
import { Monitor, OmniCanvasContext, OmniCanvasHost } from "./OmniCanvas.js";
import { CopyPaste, useNodeData } from "./react-flow-util.js";
import { SmartBezierEdge } from "./smart-edge/SmartBezierEdge.js";
import { useLocalStorage } from "./useLocalStorage.js";
import { useRefForCallback } from "./useRefForCallback.js";
import { animate } from "./util.js";
// import "./xy-theme.css";

const FlowContext = createContext<{
  runtimes: Record<string, BaseOp>;
}>(undefined!);

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

  const handleClasses = clsx`
    nodrag
    w-5 h-5
    [&.clickconnecting]:bg-red-600
    border-none

    static transform-none
  `;

  return (
    <div className="font-['Varela_Round'] flex flex-col items-center border border-gray-300 rounded-md bg-gray-100 p-2 !-z-10">
      {/* <NodeResizer
        color="#ff0071"
        isVisible={selected}
        minWidth={100}
        minHeight={30}
      /> */}
      {runtime.renderTop?.({
        ...props,
        paramValuesUP: dataUP.paramValues,
        instance: runtime,
      }) ?? <div className="above">{opClass.id}</div>}
      <div className="operation-node-body relative">
        {/* <div className="flex flex-col justify-center gap-2.5 absolute left-0 h-full -translate-x-1/2">
          {_.range(runtime.numInputs).map((i) => {
            const handle = idxToInputHandle(i);
            return (
              <Handle
                key={handle}
                type="target"
                position={Position.Left}
                id={handle}
                className={handleClasses}
              />
            );
          })}
        </div> */}
        {/* <div className="flex flex-col justify-center gap-2.5 absolute right-0 h-full translate-x-1/2">
          {_.range(runtime.numOutputs).map((i) => {
            const handle = idxToOutputHandle(i);
            return (
              <Handle
                key={handle}
                type="source"
                position={Position.Right}
                id={handle}
                className={handleClasses}
              />
            );
          })}
        </div> */}
        {outputs[0] ? (
          <div style={{ width: 200 }} className="relative">
            <Handle
              type="source"
              position={Position.Bottom}
              id={idxToOutputHandle(0)}
              className={`
                w-[200px]
                nodrag
                [&.clickconnecting]:border-red-600

                border-4 border-solid border-black rounded-sm
                !static !transform-none
                `}
            >
              <Monitor tex={outputs[0]} className="pointer-events-none" />
            </Handle>
            {/* <Handle
              type="source"
              position={Position.Bottom}
              id={idxToOutputHandle(0)}
              className={
                handleClasses +
                " absolute bottom-0 left-1/2 !-translate-x-1/2 !translate-y-1/2"
              }
            /> */}
          </div>
        ) : (
          <div
            style={{
              width: 200,
              aspectRatio: "1.77778 / 1",
              backgroundColor: "lightgray",
            }}
          />
        )}
      </div>
      {/* {selected && (
        <div className="operation-node-params below">
          {runtime.params?.map((param) => (
            <Param
              key={param.varName}
              param={param}
              data={data}
              setData={setData}
            />
          ))}
        </div>
      )} */}
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

const initialNodes: OpNode[] = [
  {
    id: "n1",
    position: { x: 0, y: 0 },
    data: { opId: "cam", paramValues: {} },
    type: "operation",
  },
  {
    id: "n2",
    position: { x: 100, y: 100 },
    data: { opId: "kal", paramValues: {} },
    type: "operation",
  },
  // {
  //   id: "n3",
  //   position: { x: 200, y: 200 },
  //   data: { opId: "minus" },
  //   type: "operation",
  // },
];

const initialEdges = [
  {
    id: "n1-n2",
    source: "n1",
    sourceHandle: "output-1",
    target: "n2",
    targetHandle: "input-1",
  },
  // {
  //   id: "n1-n3",
  //   source: "n1",
  //   sourceHandle: "output-1",
  //   target: "n3",
  //   targetHandle: "input-1",
  // },
  // {
  //   id: "n2-n3",
  //   source: "n2",
  //   sourceHandle: "output-1",
  //   target: "n3",
  //   targetHandle: "input-2",
  // },
];

const nodeTypes: NodeTypes = {
  operation: OpNodeView,
};

export const Flow = () => (
  <div className="flex w-full h-full overflow-hidden box-border">
    <ReactFlowProvider>
      <OmniCanvasHost>
        <FlowInner />
      </OmniCanvasHost>
    </ReactFlowProvider>
  </div>
);

type Flow = {
  nodes: OpNode[];
  edges: Edge[];
};

const getId = () => `n${Math.random().toString(16).slice(2)}`;

const FlowInner = () => {
  const ctx = useContext(OmniCanvasContext);
  const { screenToFlowPosition } = useReactFlow();

  const [flow, setFlow] = useLocalStorage<Flow>("flow", () => ({
    nodes: initialNodes,
    edges: initialEdges,
  }));
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
            className="[--xy-edge-stroke-default:#000]"
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
}: {
  isSidebarExpanded: boolean;
  setDraggedOpId: Dispatch<SetStateAction<AnyOpId | null>>;
}) => {
  const onDragStart = useCallback(
    (event: React.DragEvent, opId: AnyOpId) => {
      setDraggedOpId(opId);
      event.dataTransfer.setData("text/plain", opId);
      event.dataTransfer.effectAllowed = "move";
    },
    [setDraggedOpId],
  );

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
                {groupOps.map((op) => (
                  <div
                    key={op.id}
                    draggable
                    onDragStart={(event) => onDragStart(event, op.id)}
                    className="p-3 bg-white border border-gray-300 rounded-lg cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-sm transition-all select-none"
                  >
                    <div className="font-medium text-gray-900">{op.id}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {op.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
