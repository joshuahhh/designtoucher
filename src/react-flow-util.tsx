import {
  Edge,
  Node,
  NodeProps,
  useOnSelectionChange,
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

// The shape we put on the clipboard. Stored as plain-text JSON (under a
// marker key) so it survives crossing into a different project — even a
// different browser tab — not just same-project pastes.
const CLIPBOARD_MARKER = "designtoucher/clipboard@1";

export type ClipboardPayload = {
  marker: typeof CLIPBOARD_MARKER;
  nodes: Node[];
  edges: Edge[];
};

// Don't hijack copy/paste when the user is interacting with a real text
// field (inputs, textareas, or anything opting out via .nocopypaste).
export function shouldIgnoreClipboardEvent(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.classList.contains("nocopypaste")) return true;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function parseClipboard(text: string): ClipboardPayload | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<ClipboardPayload>;
    if (parsed?.marker !== CLIPBOARD_MARKER || !Array.isArray(parsed.nodes)) {
      return null;
    }
    return {
      marker: CLIPBOARD_MARKER,
      nodes: parsed.nodes,
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return null;
  }
}

/**
 * Wires the browser copy/paste clipboard events to React Flow.
 *
 * - `getSelection` returns the nodes (and the edges among them) to copy.
 *   Return null/empty to let the default copy behavior through.
 * - `onPaste` receives the deserialized clipboard payload and is
 *   responsible for assigning fresh ids and inserting into the graph.
 */
export const useCopyPaste = ({
  getSelection,
  onPaste,
}: {
  getSelection: () => { nodes: Node[]; edges: Edge[] };
  onPaste: (payload: ClipboardPayload) => void;
}) => {
  const onCopyCapture = useCallback(
    (event: ClipboardEvent) => {
      if (shouldIgnoreClipboardEvent(event.target)) return;
      const { nodes, edges } = getSelection();
      if (nodes.length === 0) return; // nothing selected — let default copy run
      event.preventDefault();
      const payload: ClipboardPayload = {
        marker: CLIPBOARD_MARKER,
        nodes,
        edges,
      };
      event.clipboardData?.setData("text/plain", JSON.stringify(payload));
    },
    [getSelection],
  );

  const onPasteCapture = useCallback(
    (event: ClipboardEvent) => {
      if (shouldIgnoreClipboardEvent(event.target)) return;
      const payload = parseClipboard(
        event.clipboardData?.getData("text/plain") ?? "",
      );
      if (!payload) return; // not our data — let default paste run
      event.preventDefault();
      onPaste(payload);
    },
    [onPaste],
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

export const useReactFlowSelection = <
  NodeType extends Node = Node,
  EdgeType extends Edge = Edge,
>() => {
  const [selectedNodes, setSelectedNodes] = useState<NodeType[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<EdgeType[]>([]);

  useOnSelectionChange<NodeType, EdgeType>({
    onChange: useCallback(({ nodes, edges }) => {
      setSelectedNodes(nodes);
      setSelectedEdges(edges);
    }, []),
  });

  return { selectedNodes, selectedEdges };
};
