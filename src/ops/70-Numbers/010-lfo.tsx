import {
  defineOp,
  NumberOutputHandle,
  Sentence,
  SentenceParamNumber,
} from "../../ops-core.js";

// A numop: outputs a number, not a texture. Wire it into any number chip
// (a SentenceParamNumber with a paramKey) to drive that param.
export default defineOp({
  id: "lfo",
  outputKeys: ["out"],
  outputTypes: { out: "number" },
  initParams() {
    return { from: 0, to: 1, period: 2 };
  },
  initRuntime() {
    return { out: 0 };
  },
  run({ runtime, params }) {
    const cycles = performance.now() / 1000 / params.period;
    // 0..1, starting at "from" when cycles is whole
    const wave = (1 - Math.cos(cycles * 2 * Math.PI)) / 2;
    runtime.out = params.from + (params.to - params.from) * wave;
  },
  Render(props) {
    return (
      <>
        <Sentence>
          Oscillate from{" "}
          <SentenceParamNumber
            paramKey="from"
            value={props.params.from}
            valueUP={props.paramsUP.from}
            min={-2}
            max={2}
            step={0.01}
          />{" "}
          to{" "}
          <SentenceParamNumber
            paramKey="to"
            value={props.params.to}
            valueUP={props.paramsUP.to}
            min={-2}
            max={2}
            step={0.01}
          />{" "}
          every{" "}
          <SentenceParamNumber
            paramKey="period"
            value={props.params.period}
            valueUP={props.paramsUP.period}
            min={0.01}
            max={10}
            step={0.01}
          />{" "}
          <span className="text-[10px] text-gray-400 select-none">s</span>
        </Sentence>
        <NumberOutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["oscillator", "sine", "wave", "signal", "number", "modulate"],
});
