import { defineOp, NumberOutputHandle, Sentence } from "../../ops-core.js";

// Seconds since page load — the same clock frag ops see as their `time`
// uniform, so every time node (and shader) agrees.
export default defineOp({
  id: "time",
  outputKeys: ["out"],
  outputTypes: { out: "number" },
  initRuntime() {
    return { out: 0 };
  },
  run({ runtime }) {
    runtime.out = performance.now() / 1000;
  },
  Render() {
    return (
      <>
        <Sentence>Count seconds</Sentence>
        <NumberOutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["time", "clock", "elapsed", "stopwatch", "ramp", "number"],
});
