import _ from "lodash";
import { deleteFbo, ensureFboSize, newFbo, ShaderProgram } from "./mygl.js";
import { defineOp, Op } from "./ops-core.js";
import { getFingerprint, instrument, objectKeys, tuple } from "./util.js";

type FragOp<InputKey extends string, ParamKey extends string> = Pick<
  Op<{}, InputKey, ParamKey>,
  "id" | "inputKeys" | "RenderTop" | "initParams"
> & {
  fragBody: string;
};

const DEBUG = false;

export function defineFragOp<InputKey extends string, ParamKey extends string>(
  fragOp: FragOp<InputKey, ParamKey>,
) {
  const hasTime = fragOp.fragBody.includes("time");

  const params = fragOp.initParams?.();
  const paramKeys = params ? Object.keys(params) : [];

  const fragSrc =
    `precision mediump float;\n` +
    (hasTime ? `uniform float time;\n` : "") +
    paramKeys.map((name) => `uniform float ${name};`).join("\n") +
    `\n` +
    (fragOp.inputKeys || [])
      .map((key) => `uniform sampler2D ${key};`)
      .join("\n") +
    `\n` +
    `\nvarying vec2 uv;\n// lygia-includes\nvoid main(){\n${fragOp.fragBody}\n}
  `;

  const vertSrc = `
    attribute vec2 position; varying vec2 uv;
    void main(){ uv = 0.5*(position+1.0); gl_Position = vec4(position,0.0,1.0); }
  `;

  return defineOp({
    ...fragOp,

    initRuntime(ctx) {
      const outFbo = newFbo(ctx.gl);
      return {
        program: new ShaderProgram(
          DEBUG ? instrument(ctx.gl) : ctx.gl,
          vertSrc,
          fragSrc,
        ),
        outFbo,
        out: outFbo.tex,
      };
    },

    run({ runtime, inputs, paramValues, ctx }) {
      console.log("running frag op", fragOp.id, inputs);
      const tex1 = (inputs as any).tex1;
      if (tex1) {
        console.log(
          getFingerprint(tex1.texture),
          "vs",
          getFingerprint(runtime.out.texture),
        );
      }

      // console.log("running frag op", fragOp.id, inputs);
      inputs = _.mapValues(inputs, (tex) => tex ?? ctx.emptyTex);
      const firstInputKey = objectKeys(inputs)[0] as InputKey | undefined;
      const firstInput = firstInputKey && inputs[firstInputKey];

      const { width, height } = firstInput
        ? firstInput
        : { width: 1280, height: 720 };

      ensureFboSize(runtime.outFbo, width, height);

      DEBUG && console.groupCollapsed("Running frag op", fragOp.id);
      runtime.program.run({
        viewport: [0, 0, width, height],
        uniforms: {
          ..._.mapValues(paramValues, (value) => tuple(["1f", Number(value)])),
          ..._.mapValues(inputs, (value) =>
            tuple(["sampler2D", value!.texture] as const),
          ),
          ...(hasTime ? { time: tuple(["1f", performance.now() / 1000]) } : {}),
        },
        fullscreen: true,
        targetFramebuffer: runtime.outFbo.framebuffer,
      });
      DEBUG && console.groupEnd();
    },

    destroy({ runtime }) {
      deleteFbo(runtime.outFbo);
    },
  });
}
