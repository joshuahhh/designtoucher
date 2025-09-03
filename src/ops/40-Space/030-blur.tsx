import { defineOp, Sentence, SentenceParamNumber } from "../../ops-core.js";
import { instantiateOp } from "../../ops-flow.js";
import { defineFragOp } from "../../ops-frag.js";
import { strip } from "../../util.js";

const lineBlur = defineFragOp({
  inputKeys: ["tex1"],
  initParams: () => ({ deltaX: 0, deltaY: 0 }),
  fragBody: strip`
    // adapted from https://github.com/evanw/glfx.js/blob/master/src/filters/blur/triangleblur.js

    #include <lygia/generative/random.glsl>

    vec2 delta = vec2(deltaX, deltaY);
    vec4 color = vec4(0.0);
    float total = 0.0;

    /* randomize the lookup values to hide the fixed number of samples */
    float offset = random(gl_FragCoord.xyz);



    for (float t = -30.0; t <= 30.0; t++) {
      float percent = (t + offset - 0.5) / 30.0;
      float weight = 1.0 - abs(percent);
      vec4 sample = texture2D(tex1, uv + delta * percent);

      /* switch to pre-multiplied alpha to correctly blur transparent images */
      sample.rgb *= sample.a;

      color += sample * weight;
      total += weight;
    }

    gl_FragColor = color / total;

    /* switch back from pre-multiplied alpha */
    gl_FragColor.rgb /= gl_FragColor.a + 0.00001;
  `,
  id: undefined as any,
  Render: undefined as any,
});

export default defineOp({
  id: "blur",
  inputKeys: ["tex1"],
  initParams: () => ({ size: 0.01 }),
  initRuntime(ctx) {
    const lineBlurX = instantiateOp(lineBlur, ctx, "constant-op");
    const lineBlurY = instantiateOp(lineBlur, ctx, "constant-op");
    return {
      lineBlurX,
      lineBlurY,
      out: lineBlurY.runtime.out,
    };
  },
  run({ inputs, params, runtime, ctx }) {
    const tex = inputs.tex1;
    if (!tex) {
      return;
    }

    // params.size refers to fraction of the smaller dimension
    let deltaX = (params.size * Math.min(tex.width, tex.height)) / tex.width;
    let deltaY = (params.size * Math.min(tex.width, tex.height)) / tex.height;

    runtime.lineBlurX.run({
      ctx,
      inputs: { tex1: tex },
      params: { deltaX, deltaY: 0 },
    });
    runtime.lineBlurY.run({
      ctx,
      inputs: { tex1: runtime.lineBlurX.runtime.out },
      params: { deltaX: 0, deltaY },
    });
  },
  destroy({ runtime, ctx }) {
    runtime.lineBlurX.destroy({ ctx });
    runtime.lineBlurY.destroy({ ctx });
  },
  Render(props) {
    return (
      <>
        <Sentence>
          Blur2 <props.InputHandle key="tex1" inputKey="tex1" /> with size{" "}
          <SentenceParamNumber
            value={props.params.size}
            valueUP={props.paramsUP.size}
            min={0}
            max={0.2}
            step={0.001}
          />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
