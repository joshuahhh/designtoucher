import {
  Node,
  NodeProps,
  ReactFlowInstance,
  useReactFlow,
} from "@xyflow/react";
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { useRefForCallback } from "./useRefForCallback.js";

export function useSetNodeData<D extends Record<string, unknown>>(
  props: NodeProps<Node<D>>,
): (changeData: (oldData: D) => D) => void {
  const { setNodes } = useReactFlow<Node<D>>();

  return (changeData: (oldData: D) => D) => {
    setNodes((nodes) =>
      nodes.map((n) =>
        n.id === props.id ? { ...n, data: changeData(n.data) } : n,
      ),
    );
  };
}

// react-flow docs say: "When dealing with input fields you don’t
//   want to use a nodes data object as UI state directly. There is a
//   delay in updating the data object and the cursor might jump
//   around erratically and lead to unwanted inputs."
//
// This hook provides a safer way of accessing node data. It stores a
// copy of the node's data as standard React state, and syncs it
// bidirectionally with the react-flow node's data object.
export function useNodeData<D extends Record<string, unknown>>(
  props: NodeProps<Node<D>>,
): [D, Dispatch<SetStateAction<D>>] {
  const { setNodes } = useReactFlow<Node<D>>();
  const [data, setData] = useState<D>(props.data);

  // Update the react-flow node's data object whenever the local
  // state changes.
  useLayoutEffect(() => {
    setNodes((nodes) =>
      nodes.map((n) => (n.id === props.id ? { ...n, data } : n)),
    );
  }, [data, props.id, setNodes]);

  // Update the local state whenever the react-flow node's data
  // object changes (tho check for equality first, to avoid loops).
  const dataRef = useRefForCallback(data);
  useLayoutEffect(() => {
    if (props.data !== dataRef.current) {
      setData(props.data);
    }
  }, [props.data, dataRef]);

  return [data, setData];
}

export const CopyPaste = () => {
  const rfInstance = useReactFlow();
  useCopyPaste(rfInstance);
  return null; // This component does not render anything
};

export const useCopyPaste = (rfInstance: ReactFlowInstance | null) => {
  const onCopyCapture = useCallback(
    (event: ClipboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.classList.contains("nocopypaste")
      ) {
        return;
      }
      event.preventDefault();
      const nodes = JSON.stringify(
        rfInstance?.getNodes().filter((n) => n.selected),
      );

      event.clipboardData?.setData("flowchart:nodes", nodes);
    },
    [rfInstance],
  );

  const onPasteCapture = useCallback(
    (event: ClipboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.classList.contains("nocopypaste")
      ) {
        return;
      }
      event.preventDefault();
      const nodes = JSON.parse(
        event.clipboardData?.getData("flowchart:nodes") || "[]",
      ) as Node[] | undefined;
      if (nodes) {
        const randomId = () => Math.random().toString(16).slice(2);
        rfInstance?.setNodes([
          ...rfInstance.getNodes().map((n) => ({ ...n, selected: false })),
          ...nodes.map((n) => ({
            ...n,
            selected: true,
            id: randomId(),
            position: { x: n.position.x + 10, y: n.position.y + 10 },
          })),
        ]);
      }
    },
    [rfInstance],
  );

  useEffect(() => {
    window.addEventListener("copy", onCopyCapture);
    window.addEventListener("paste", onPasteCapture);
    return () => {
      window.removeEventListener("copy", onCopyCapture);
      window.removeEventListener("paste", onPasteCapture);
    };
  }, [onCopyCapture, onPasteCapture]);
};
