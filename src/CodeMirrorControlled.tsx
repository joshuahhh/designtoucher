import { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { useEffect, useMemo, useState } from "react";
import { CodeMirror } from "./CodeMirror.js";

// this wraps CodeMirror to make it controlled by a value prop.
// (more or less; if the controller rejects a change it might still go through...)

export function CodeMirrorControlled({
  extensions,
  value,
  setValue,
  ...divProps
}: React.HTMLAttributes<HTMLDivElement> & {
  extensions: Extension;
  value: string;
  setValue?: (value: string) => void;
}) {
  const [editorView, setEditorView] = useState<EditorView | null>(null);

  // CodeMirror -> value
  const valueSettingExtension: Extension = useMemo(
    () =>
      setValue
        ? EditorView.updateListener.of((vu: ViewUpdate) => {
            if (vu.docChanged) {
              const doc = vu.state.doc;
              const text = doc.toString();
              setValue(text);
            }
          })
        : EditorState.readOnly.of(true),
    [setValue],
  );

  const allExtensions = useMemo(
    () => [valueSettingExtension, extensions ?? []],
    [extensions, valueSettingExtension],
  );

  // value -> CodeMirror
  useEffect(() => {
    if (!editorView) {
      return;
    }
    const currentValue = editorView.state.doc.toString();
    if (value !== currentValue) {
      editorView.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
      });
    }
  }, [editorView, value]);

  return (
    <CodeMirror
      initialDoc={value}
      extensions={allExtensions}
      setEditorView={setEditorView}
      {...divProps}
    />
  );
}
