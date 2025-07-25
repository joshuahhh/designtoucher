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

  const [runtimes, setRuntimes] = useState<Record<string, OpRuntime>>({});

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) =>
      flowUP.nodes.$((nodes) => applyNodeChanges(changes, nodes)),
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
    <div className="w-full h-full">
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
          defaultViewport={{ x: 100, y: 100, zoom: 2 }}
        >
          <MiniMap zoomable pannable />
          <Controls />
          <Background />
          <CopyPaste />
        </ReactFlow>
      </FlowContext.Provider>
    </div>
  );
};
