import { up } from "@engraft/update-proxy";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BuiltInNode,
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
  Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import _ from "lodash";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  idxToInputHandle,
  idxToOutputHandle,
  opById,
  OpNode,
  OpRuntime,
  runFlow,
} from "./flow-lib.js";
import { Monitor, OmniCanvasContext, OmniCanvasHost } from "./OmniCanvas.js";
import { CopyPaste, useSetNodeData } from "./react-flow-util.js";
import { useLocalStorage } from "./useLocalStorage.js";
import { useRefForCallback } from "./useRefForCallback.js";
import { animate } from "./util.js";
import "./xy-theme.css";

const FlowContext = createContext<{
  runtimes: Record<string, OpRuntime>;
}>(undefined!);

export function OperationNode(props: NodeProps<OpNode>) {
  const { selected } = props;

  const { runtimes } = useContext(FlowContext);

  const setNodeData = useSetNodeData(props);
  const operation = opById(props.data.opId);
  const runtime = runtimes[props.id];

  if (!runtime) {
    return null;
  }

  const outputs = runtime.getOutputs();

  return (
    <div className="operation-node">
      {/* <NodeResizer
        color="#ff0071"
        isVisible={selected}
        minWidth={100}
        minHeight={30}
      /> */}
      <h3>Node: {props.id}</h3>
      <h3>Operation: {operation.id}</h3>
      <div className="operation-node-inputs">
        {_.range(operation.numInputs).map((i) => {
          const handle = idxToInputHandle(i);
          return (
            <Handle
              key={handle}
              type="target"
              position={Position.Left}
              id={handle}
              className="nodrag"
              style={{ transform: `translateY(${i * 30}px)` }}
            />
          );
        })}
      </div>
      <div className="operation-node-outputs">
        {_.range(operation.numOutputs).map((i) => {
          const handle = idxToOutputHandle(i);
          return (
            <Handle
              key={handle}
              type="source"
              position={Position.Right}
              id={handle}
              className="nodrag"
            />
          );
        })}
      </div>
      {outputs[0] && (
        <div style={{ width: 200 }}>
          <Monitor tex={outputs[0]} />
        </div>
      )}
    </div>
  );
}

type CustomNodeType = BuiltInNode | OpNode;

const initialNodes: OpNode[] = [
  {
    id: "n1",
    position: { x: 0, y: 0 },
    data: { opId: "webcam" },
    type: "operation",
  },
  {
    id: "n2",
    position: { x: 100, y: 100 },
    data: { opId: "delay" },
    type: "operation",
  },
  {
    id: "n3",
    position: { x: 200, y: 200 },
    data: { opId: "minus" },
    type: "operation",
  },
];

const initialEdges = [
  {
    id: "n1-n2",
    source: "n1",
    sourceHandle: "output-1",
    target: "n2",
    targetHandle: "input-1",
  },
  {
    id: "n1-n3",
    source: "n1",
    sourceHandle: "output-1",
    target: "n3",
    targetHandle: "input-1",
  },
  {
    id: "n2-n3",
    source: "n2",
    sourceHandle: "output-1",
    target: "n3",
    targetHandle: "input-2",
  },
];

const nodeTypes: NodeTypes = {
  operation: OperationNode,
};

export const Flow = () => (
  <div className="flex w-full h-full overflow-hidden box-border">
    <OmniCanvasHost>
      <FlowInner />
    </OmniCanvasHost>
  </div>
);

type Flow = {
  nodes: OpNode[];
  edges: Edge[];
};

const FlowInner = () => {
  const ctx = useContext(OmniCanvasContext);

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

  const [runtimes, setRuntimes] = useState<Record<string, OpRuntime>>({});
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);

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
    (params: Connection) => flowUP.edges.$((edges) => addEdge(params, edges)),
    [flowUP.edges],
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
          >
            <MiniMap zoomable pannable />
            <Controls />
            <Background />
            <CopyPaste />
          </ReactFlow>
        </FlowContext.Provider>
        
        {/* Toggle Button */}
        <button
          onClick={() => setIsPanelExpanded(!isPanelExpanded)}
          className="absolute top-4 right-4 z-10 bg-white border border-gray-300 rounded-md p-2 shadow-sm hover:bg-gray-50 transition-colors"
        >
          {isPanelExpanded ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          )}
        </button>
      </div>
      
      {/* Expandable Panel */}
      <div className={`transition-all duration-300 ease-in-out bg-gray-50 border-l border-gray-200 ${
        isPanelExpanded ? 'w-80 opacity-100' : 'w-0 opacity-0'
      } overflow-hidden`}>
        <div className="p-4 h-full">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">Components</h3>
          <div className="space-y-2">
            <div className="text-sm text-gray-600">
              Drag and drop components will go here
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
