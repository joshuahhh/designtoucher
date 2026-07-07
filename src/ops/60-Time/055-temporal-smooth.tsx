import {
  destroyFbo,
  ensureFboSize,
  newFbo,
  ShaderProgram,
} from "../../mygl.js";
import { defineOp, Sentence, SentenceParamNumber } from "../../ops-core.js";

const VERT = `
  attribute vec2 position;
  varying vec2 uv;
  void main() {
    uv = 0.5 * (position + 1.0);
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

export default defineOp({
  id: "temporal-smooth",
  inputKeys: ["in"] as const,
  initParams: () => ({
    halfLifeFrames: 2,
  }),
  initRuntime(ctx) {
    const { gl } = ctx;

    const outFbo = newFbo(gl);

    const smoothProgram = new ShaderProgram(
      gl,
      VERT,
      `
      precision mediump float;
      varying vec2 uv;
      uniform sampler2D curr;
      uniform sampler2D prevSmooth;
      uniform float amount;
      void main() {
        gl_FragColor = mix(
          texture2D(curr, uv),
          texture2D(prevSmooth, uv),
          amount
        );
      }
    `,
    );

    return {
      // ping-pong pair for the EMA state (can't read + write one texture)
      stateFbos: [newFbo(gl), newFbo(gl)],
      stateIdx: 0,
      inited: false,
      smoothProgram,
      outFbo,
      out: outFbo.tex,
    };
  },

  run({ inputs, params, runtime, ctx }) {
    const tex = inputs.in;
    if (!tex) return;

    const { draw } = ctx;
    const w = tex.width;
    const h = tex.height;

    ensureFboSize(runtime.stateFbos[0], w, h);
    ensureFboSize(runtime.stateFbos[1], w, h);
    ensureFboSize(runtime.outFbo, w, h);

    const stateFbo = runtime.stateFbos[runtime.stateIdx];
    const prevStateFbo = runtime.stateFbos[1 - runtime.stateIdx];
    runtime.stateIdx = 1 - runtime.stateIdx;

    // The EMA retention factor that closes half the remaining gap to the
    // input in halfLifeFrames frames: amount^halfLifeFrames = 0.5.
    const amount =
      params.halfLifeFrames <= 0 ? 0 : 0.5 ** (1 / params.halfLifeFrames);

    // EMA: blend this frame into the running average. First frame seeds
    // the average with the input (amount 0).
    runtime.smoothProgram.run({
      targetFramebuffer: stateFbo.framebuffer,
      viewport: [0, 0, w, h],
      uniforms: {
        curr: ["sampler2D", tex.texture],
        prevSmooth: ["sampler2D", prevStateFbo.tex.texture],
        amount: ["1f", runtime.inited ? amount : 0],
      },
      fullscreen: true,
    });
    runtime.inited = true;

    // Copy to a stable out FBO instead of outputting the ping-pong texture
    // directly (see the delay op for the glitches that causes).
    draw({
      tex: stateFbo.tex,
      targetFramebuffer: runtime.outFbo.framebuffer,
      viewport: [0, 0, w, h],
    });
  },

  destroy({ runtime }) {
    destroyFbo(runtime.stateFbos[0]);
    destroyFbo(runtime.stateFbos[1]);
    destroyFbo(runtime.outFbo);
  },

  Render(props) {
    return (
      <>
        <Sentence>
          Smooth <props.InputHandle inputKey="in" /> over time, half-life{" "}
          <SentenceParamNumber
            paramKey="halfLifeFrames"
            value={props.params.halfLifeFrames}
            valueUP={props.paramsUP.halfLifeFrames}
            min={0}
            max={60}
            step={1}
          />{" "}
          frames
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },

  searchHints: [
    "AKA: EMA, exponential moving average, lowpass, deflicker, trails, average.",
  ],
});
