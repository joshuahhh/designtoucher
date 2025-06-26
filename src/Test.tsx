import { basicSetup, EditorView } from "codemirror";
import { useEffect } from "react";

export const Test = () => {
  useEffect(() => {
    const view = new EditorView({
      doc: "Start document",
      parent: document.body,
      extensions: [basicSetup],
    });
    return () => {
      view.destroy();
    };
  }, []);

  return (
    <div>
      <h1>Test Page</h1>
      <p>This is a placeholder for the test page.</p>
      <p>Here you can add your test components or functionality.</p>
    </div>
  );
};
