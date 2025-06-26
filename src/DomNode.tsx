import React, { useEffect, useState } from "react";

type Props = React.HTMLProps<HTMLDivElement> & {
  node: HTMLElement | undefined;
  apply?: (node: HTMLElement) => void;
};

function DomNode({ node, apply, ...rest }: Props) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (apply && node) {
      apply(node);
    }
  }, [node, apply]);

  useEffect(() => {
    if (container) {
      while (container.lastChild) {
        container.removeChild(container.lastChild);
      }
      if (node) {
        container.appendChild(node);
      }
    }
  }, [node, container]);

  return <div ref={setContainer} {...rest} />;
}

export default DomNode;
