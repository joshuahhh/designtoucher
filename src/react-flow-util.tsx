import {
  Node,
  NodeProps,
  ReactFlowInstance,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect } from "react";

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

export const CopyPaste = () => {
  const rfInstance = useReactFlow();
  useCopyPaste(rfInstance);
  return null; // This component does not render anything
};

export const useCopyPaste = (rfInstance: ReactFlowInstance | null) => {
  const onCopyCapture = useCallback(
    (event: ClipboardEvent) => {
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
    return () => {
      window.removeEventListener("copy", onCopyCapture);
    };
  }, [onCopyCapture]);

  useEffect(() => {
    window.addEventListener("paste", onPasteCapture);
    return () => {
      window.removeEventListener("paste", onPasteCapture);
    };
  }, [onPasteCapture]);
};
