import { marked } from "marked";
import { useRef, useState } from "react";
import { UpdateProxy } from "update-proxy";
import { defineOp } from "../../ops-core.js";

type LabelParams = {
  text: string;
};

export default defineOp({
  id: "label",
  inputKeys: [] as string[],
  outputKeys: [],

  initParams(): LabelParams {
    return { text: "Label here" };
  },

  Render(props) {
    const params = props.params as unknown as LabelParams;
    const paramsUP = props.paramsUP as unknown as UpdateProxy<LabelParams>;
    const [editing, setEditing] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const html = marked.parse(params.text, { async: false }) as string;

    return (
      <div className="-m-2 p-2 rounded-md bg-yellow-50">
        {editing ? (
          <textarea
            ref={textareaRef}
            autoFocus
            value={params.text}
            onChange={(e) => paramsUP.text.$set(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            className="nodrag nowheel block w-full min-w-[120px] min-h-[60px] resize text-xs bg-transparent outline-none border border-yellow-300 rounded px-1.5 py-1 font-mono"
          />
        ) : (
          <div
            onClick={() => setEditing(true)}
            className="nodrag prose prose-sm prose-neutral max-w-none cursor-text min-w-[60px] text-xs [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    );
  },
});
