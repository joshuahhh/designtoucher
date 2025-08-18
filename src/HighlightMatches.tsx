import { useLayoutEffect, useRef, useState } from "react";

export const HighlightMatches = ({
  query,
  setHasMatches,
  ...props
}: {
  query: string;
  setHasMatches?: (hasMatches: boolean) => void;
} & React.HTMLProps<HTMLDivElement>) => {
  const idRef = useRef<string>(
    "search-result-highlight-" + Math.random().toString(36).slice(2),
  );

  const [wrapperDiv, setWrapperDiv] = useState<HTMLDivElement | null>(null);

  const [allTextNodes, setAllTextNodes] = useState<Node[]>([]);

  useLayoutEffect(() => {
    if (!wrapperDiv) return;

    const allTextNodes: Node[] = [];
    {
      const treeWalker = document.createTreeWalker(
        wrapperDiv,
        NodeFilter.SHOW_TEXT,
      );
      let currentNode = treeWalker.nextNode();
      while (currentNode) {
        allTextNodes.push(currentNode);
        currentNode = treeWalker.nextNode();
      }
    }
    setAllTextNodes(allTextNodes);
  }, [wrapperDiv]);

  useLayoutEffect(() => {
    CSS.highlights.delete(idRef.current);

    if (!query) {
      return;
    }

    const ranges = allTextNodes
      .map((el) => {
        return { el, text: el.textContent?.toLowerCase() };
      })
      // TODO: split query on spaces and match each part
      .filter(({ text }) => text?.includes(query))
      .map(({ text, el }) => {
        // Find all instances of str in el.textContent
        const indices = [];
        let startPos = 0;
        while (startPos < text!.length) {
          const index = text!.indexOf(query, startPos);
          if (index === -1) break;
          indices.push(index);
          startPos = index + query.length;
        }

        return indices.map((index) => {
          const range = new Range();
          range.setStart(el, index);
          range.setEnd(el, index + query.length);
          return range;
        });
      });

    setHasMatches?.(ranges.length > 0);

    const highlight = new Highlight(...ranges.flat());
    CSS.highlights.set(idRef.current, highlight);
  }, [allTextNodes, query, setHasMatches]);

  return (
    <>
      <style>
        {`
          ::highlight(${idRef.current}) {
            background-color: orange;
            color: black;
          }
        `}
      </style>
      <div ref={setWrapperDiv} {...props} />
    </>
  );
};
