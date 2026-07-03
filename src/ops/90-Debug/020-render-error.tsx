import { useState } from "react";
import { defineOp, Sentence, SentenceButton } from "../../ops-core.js";

export default defineOp({
  id: "render-error",
  inputKeys: [] as string[],
  outputKeys: [],

  Render() {
    const [explode, setExplode] = useState(false);
    if (explode) {
      throw new Error("Intentional render error from render-error debug op");
    }
    return (
      <Sentence>
        <SentenceButton
          className="text-red-500"
          onClick={() => setExplode(true)}
        >
          Throw render error
        </SentenceButton>
      </Sentence>
    );
  },

  searchHints: ["error", "throw", "crash", "boom", "debug"],
});
