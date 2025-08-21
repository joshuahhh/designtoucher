import { defineOp, Sentence } from "../../ops-core.js";
import { instantiateOp } from "../../ops-flow.js";
import { defineFragOp } from "../../ops-frag.js";
import { strip } from "../../util.js";

const channelOps = [
  ["g", "b"],
  ["r", "b"],
  ["r", "g"],
].map(([c1, c2]) =>
  defineFragOp({
    id: "split-colors-channel",
    inputKeys: ["tex1"],
    fragBody: strip`
      gl_FragColor = texture2D(tex1, uv);
      gl_FragColor.${c1} = 0.0;
      gl_FragColor.${c2} = 0.0;
    `,
    Render: undefined as any,
  }),
);

export default defineOp({
  id: "split-colors",
  inputKeys: ["tex1"],
  initRuntime(ctx) {
    const channelOpInstances = channelOps.map((op) =>
      instantiateOp(op, ctx, "constant-op"),
    );
    return {
      channelOpInstances,
      outR: channelOpInstances[0].runtime.out,
      outG: channelOpInstances[1].runtime.out,
      outB: channelOpInstances[2].runtime.out,
    };
  },
  run({ inputs, params, runtime, ctx }) {
    const tex = inputs.tex1;
    if (!tex) {
      return;
    }

    runtime.channelOpInstances.forEach((channel) => {
      channel.run({ ctx, inputs: { tex1: tex }, params: {} });
    });
  },
  destroy({ runtime, ctx }) {
    runtime.channelOpInstances.forEach((channel) => {
      channel.destroy({ ctx });
    });
  },
  Render(props) {
    return (
      <>
        <Sentence>
          Split colors of <props.InputHandle inputKey="tex1" />
        </Sentence>
        <div className="flex gap-1 text-xs font-['Varela_Round']">
          R: <props.OutputHandle outputKey="outR" size={0.5} />
          G: <props.OutputHandle outputKey="outG" size={0.5} />
          B: <props.OutputHandle outputKey="outB" size={0.5} />
        </div>
      </>
    );
  },
});
