import { ensureFboSize, newFbo } from "../../mygl.js";
import { defineOp, Sentence } from "../../ops-core.js";

export default defineOp({
  id: "feedback-buffer",
  inputKeys: ["in"],
  inputKeysLate: ["in"],
  initRuntime(ctx) {
    const fbo = newFbo(ctx.gl);
    return { fbo, out: fbo.tex };
  },
  runLate({ runtime, inputs, ctx }) {
    const tex = inputs.in;
    if (!tex) {
      return;
    }

    ensureFboSize(runtime.fbo, tex.width, tex.height);
    ctx.draw({
      tex,
      targetFramebuffer: runtime.fbo.framebuffer,
      viewport: [0, 0, tex.width, tex.height],
    });
  },
  Render(props) {
    return (
      <>
        <Sentence>
          Buffer feedback from <props.InputHandle inputKey="in" />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
