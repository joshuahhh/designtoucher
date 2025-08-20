import { destroyFbo, ensureFboSize, Fbo, newFbo } from "../../mygl.js";
import { defineOp, Sentence, SentenceParamNumber } from "../../ops-core.js";
import { popFront, pushBack, pushFront } from "../../util.js";

export default defineOp({
  id: "delay",
  inputKeys: ["tex1"],
  initParams: () => ({
    framesOfDelay: 30,
  }),
  initRuntime(ctx) {
    const outFbo = newFbo(ctx.gl);

    return {
      fbos: [] as Fbo[],

      outFbo: outFbo,
      out: outFbo.tex,
    };
  },
  run({ inputs, params, runtime, ctx }) {
    const { gl, draw } = ctx;
    const tex = inputs.tex1;
    if (!tex) {
      return;
    }
    const ringLength = params.framesOfDelay + 1;

    if (runtime.fbos.length < ringLength) {
      console.log("delay: lengthening ring");
      pushFront(runtime.fbos, newFbo(gl));
    }

    // get rid of extraneous textures
    while (runtime.fbos.length > ringLength) {
      console.log("delay: shortening");
      destroyFbo(popFront(runtime.fbos)!);
    }

    // cycle the ring
    const oldestFbo = popFront(runtime.fbos)!;
    ensureFboSize(oldestFbo, tex.width, tex.height);
    draw({
      tex,
      targetFramebuffer: oldestFbo.framebuffer,
      viewport: [0, 0, tex.width, tex.height],
    });
    pushBack(runtime.fbos, oldestFbo);

    if (runtime.fbos.length < ringLength) {
      return;
    }

    // TODO: ideally we'd just return this.fbos[0].tex, but this
    // glitches out... race condition? anyway let's just copy it to a
    // new FBO and avoid that trouble.
    ensureFboSize(runtime.outFbo, tex.width, tex.height);
    draw({
      tex: runtime.fbos[0].tex,
      targetFramebuffer: runtime.outFbo.framebuffer,
      viewport: [0, 0, tex.width, tex.height],
    });
  },
  destroy({ runtime }) {
    runtime.fbos.forEach((fbo) => destroyFbo(fbo));
    destroyFbo(runtime.outFbo);
  },
  Render(props) {
    return (
      <>
        <Sentence>
          Delay <props.InputHandle inputKey="tex1" /> by{" "}
          <SentenceParamNumber
            value={props.params.framesOfDelay}
            valueUP={props.paramsUP.framesOfDelay}
            min={1}
            max={300}
            step={1}
          />{" "}
          frames
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["AKA: wait, past."],
});
