import {
  defineOp,
  NumberOutputHandle,
  Sentence,
  SentenceParamNumber,
} from "../../ops-core.js";

// Pseudo-random gradient in [-1, 1] at an integer lattice point.
function gradAt(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return 2 * (x - Math.floor(x)) - 1;
}

// Classic 1D gradient (Perlin-style) noise: smooth, wanders in ~[-0.5, 0.5].
function noise1d(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const v0 = gradAt(i) * f;
  const v1 = gradAt(i + 1) * (f - 1);
  return v0 + u * (v1 - v0);
}

export default defineOp({
  id: "noise",
  outputKeys: ["out"],
  outputTypes: { out: "number" },
  initParams() {
    return { speed: 1 };
  },
  initRuntime() {
    // Random offset so separate noise nodes don't move identically.
    return { out: 0.5, offset: Math.random() * 1e6, phase: 0, lastTime: 0 };
  },
  run({ runtime, params }) {
    // Integrate phase by dt (rather than t = now * speed) so scrubbing the
    // speed changes the rate of wandering without jumping the position.
    const now = performance.now() / 1000;
    const dt = Math.min(now - runtime.lastTime, 0.1);
    runtime.lastTime = now;
    runtime.phase += dt * params.speed;
    runtime.out = 0.5 + noise1d(runtime.phase + runtime.offset);
  },
  Render(props) {
    return (
      <>
        <Sentence>
          Make noise with speed{" "}
          <SentenceParamNumber
            paramKey="speed"
            value={props.params.speed}
            valueUP={props.paramsUP.speed}
            min={0}
            max={10}
            step={0.01}
          />
        </Sentence>
        <NumberOutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: [
    "perlin",
    "simplex",
    "random",
    "wander",
    "drift",
    "wobble",
    "number",
  ],
});
