import _ from "lodash";
import {
  destroyFbo,
  ensureFboSize,
  newFbo,
  ShaderProgram,
  Tex,
} from "./mygl.js";
import { defineOp, Op } from "./ops-core.js";
import { instrument, objectKeys, tuple } from "./util.js";

type FragOp<
  InputKey extends string,
  Params extends Record<string, unknown>,
> = Omit<
  Op<{ out: Tex }, InputKey, Params>,
  // stuff we define
  | "initRuntime"
  | "run"
  | "destroy"
  // stuff we don't define but why are you defining it?
  | "inputKeysLate"
  | "runLate"
> & {
  fragBody: string;
};

const DEBUG = false;

export function defineFragOp<
  Runtime extends Record<string, unknown>,
  InputKey extends string,
  Params extends Record<string, unknown>,
>(fragOp: FragOp<InputKey, Params>) {
  const params = fragOp.initParams?.();
  const paramKeys = params ? Object.keys(params) : [];

  const fragSrc = `
    precision mediump float;

    uniform float time;
    uniform vec2 resolution;
    ${(fragOp.inputKeys ?? [])
      .map((key) => `uniform sampler2D ${key}; uniform int has_${key};`)
      .join("\n")}
    ${(paramKeys ?? []).map((name) => `uniform float ${name};`).join("\n")}
    varying vec2 uv;

    #define PLATFORM_WEBGL
    #define GAUSSIANBLUR2D_KERNELSIZE 100
    // lygia-includes
    void main() {
      ${fragOp.fragBody}
    }
  `;

  const vertSrc = `
    attribute vec2 position;
    varying vec2 uv;
    void main() {
      uv = 0.5 * (position + 1.0);
      gl_Position = vec4(position, 0.0, 1.0);
    }
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

    run({ runtime, inputs, params, ctx }) {
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
          ..._.mapValues(params, (value) =>
            tuple(["1f", Number(value)] as const),
          ),
          ...Object.fromEntries(
            (fragOp.inputKeys || []).flatMap((key) => [
              [
                key,
                tuple([
                  "sampler2D",
                  inputs[key] ? inputs[key].texture : ctx.emptyTex.texture,
                ] as const),
              ],
              [`has_${key}`, tuple(["1i", inputs[key] ? 1 : 0] as const)],
            ]),
          ),
          time: tuple(["1f", performance.now() / 1000] as const),
          resolution: tuple(["2f", [width, height]] as const),
        },
        fullscreen: true,
        targetFramebuffer: runtime.outFbo.framebuffer,
      });
      DEBUG && console.groupEnd();
    },

    destroy({ runtime }) {
      destroyFbo(runtime.outFbo);
    },
  });
}
