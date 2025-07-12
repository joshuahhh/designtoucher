import _ from "lodash";
import { DrawCommand, Framebuffer2D, Regl, Texture2D } from "regl";
import { assert } from "./assert.js";
import { Fbo } from "./fbo.js";
import { OmniCanvasContext } from "./OmniCanvas.js";

export type ParameterValues = { [parameterName: string]: any };

export type Value = {
  type: "texture";
  // the rule is that you can't rely on this texture being immutable
  // for more than the current tick; copy it if you care
  texture: Texture2D;
};
// | {
//     type: "contours";
//     contours: cv.MatVector;
//     hierarchy: cv.Mat;
//   }
// | {
//     type: "contour";
//     contour: cv.Mat;
//   }
// | {
//     type: "point";
//     point: { x: number; y: number };
//   }
// | {
//     type: "raw";
//     data: any;
//   };

export type CommandResult =
  | Value
  | {
      type: "error";
      error: Error;
    };

export type ProgramState = {
  intermediate: { [id: string]: CommandResult };
} & (
  | {
      type: "active";
      vars: { [name: string]: Value };
      stack: Value[];
    }
  | {
      type: "error";
    }
);

export abstract class CommandRunner {
  constructor(
    public id: string,
    public lineNum: number,
    public parameterValues: ParameterValues,
    public originalLine: string,
    public ctx: OmniCanvasContext,
  ) {}

  abstract run(state: ProgramState): ProgramState;
}

export class CommandRunnerSaveToVar extends CommandRunner {
  resources: { texture: Texture2D; fbo: Framebuffer2D } | undefined = undefined;

  run(state: ProgramState): ProgramState {
    const varName = this.parameterValues["varName"];
    if (state.type === "error") return state;
    const value = state.stack[state.stack.length - 1];

    if (!this.resources) {
      const texture = this.ctx.regl.texture();
      this.resources = {
        texture,
        fbo: this.ctx.regl.framebuffer({ color: texture }),
      };
    }
    const { texture, fbo } = this.resources;

    this.ctx.copy({ tex1: value.texture });

    return {
      ...state,
      vars: {
        ...state.vars,
        [varName]: { type: "texture", texture } satisfies Value,
      },
    };
  }
}

export class CommandRunnerLoadFromVar extends CommandRunner {
  run(state: ProgramState): ProgramState {
    const varName = this.parameterValues["varName"];
    if (state.type === "error") return state;
    return {
      ...state,
      stack: [...state.stack, state.vars[varName]],
      intermediate: {
        ...state.intermediate,
        [this.id]: state.vars[varName] satisfies CommandResult,
      },
    };
  }
}

export abstract class CommandRunnerFromStack extends CommandRunner {
  abstract runFromStack(stack: Value[]): Value;

  run(state: ProgramState): ProgramState {
    if (state.type === "error") return state;
    try {
      const value = this.runFromStack(state.stack);
      return {
        ...state,
        intermediate: { ...state.intermediate, [this.id]: value },
        stack: [...state.stack, value],
      };
    } catch (error) {
      const result: CommandResult = {
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      };
      return {
        type: "error",
        intermediate: { ...state.intermediate, [this.id]: result },
      };
    }
  }
}

function props(regl: Regl, names: string[]): { [name: string]: any } {
  return Object.fromEntries(
    names.map((name) => [name, regl.prop<any, any>(name)]),
  );
}

export abstract class CommandRunnerRegl extends CommandRunnerFromStack {
  resources:
    | { draw: DrawCommand; texture: Texture2D; fbo: Framebuffer2D }
    | undefined = undefined;

  abstract get arity(): number;
  abstract get frag(): string;
  abstract get params(): string[];

  runFromStack(stack: Value[]): Value {
    // console.log("running regl command, lineNum = ", this.lineNum);
    const arity = this.arity;
    const inputs = stack.slice(-arity);

    const { regl } = this.ctx;

    if (!this.resources) {
      const draw = regl({
        frag: this.frag,
        vert: `
          precision mediump float;
          attribute vec2 position;
          varying vec2 uv;
          void main () {
            uv = 0.5 * (position + 1.0);
            gl_Position = vec4(position, 0.0, 1.0);
          }`,
        attributes: { position: [-1, -1, 1, -1, -1, 1, 1, 1] },
        elements: [
          [0, 1, 2],
          [2, 1, 3],
        ],
        uniforms: {
          ...props(
            regl,
            _.range(arity).map((i) => `tex${i + 1}`),
          ),
          ...props(regl, this.params),
        },
      });

      const texture = this.ctx.regl.texture();
      this.resources = {
        draw,
        texture,
        fbo: this.ctx.regl.framebuffer({ color: texture }),
      };
    }
    const { draw, texture, fbo } = this.resources;

    regl.poll();

    fbo.resize(inputs[0].texture.width, inputs[0].texture.height);

    regl
      .framebuffer({
        color: inputs[0].texture,
      })
      .use(() => {
        console.log("input", _.sum(regl.read()));
      });

    fbo.use(() => {
      // regl.poll();
      draw({
        ...this.parameterValues,
        ...Object.fromEntries(
          inputs.map((input, i) => [`tex${i + 1}`, input.texture]),
        ),
      });
      regl.poll();
      console.log("fbo", _.sum(regl.read()));
    });

    return { type: "texture", texture };
  }
}

export class CommandRunnerIden extends CommandRunnerRegl {
  arity = 1;
  frag = `
    precision mediump float;
    uniform sampler2D tex1, tex2;
    uniform float alpha;
    varying vec2 uv;
    void main () {
      gl_FragColor = texture2D(tex1, uv);
    }
  `;
  params = [];
}

export class CommandRunnerBlend extends CommandRunnerRegl {
  arity = 2;
  frag = `
    precision mediump float;
    uniform sampler2D tex1, tex2;
    uniform float alpha;
    varying vec2 uv;
    void main () {
      vec3 col1 = texture2D(tex1, uv).rgb;
      vec3 col2 = texture2D(tex2, uv).rgb;
      gl_FragColor = vec4(col1 * alpha + col2 * (1.0 - alpha), 1.0);
    }
  `;
  params = ["alpha"];
}

export class CommandRunnerMinus extends CommandRunnerRegl {
  arity = 2;
  frag = `
    precision mediump float;
    uniform sampler2D tex1, tex2;
    uniform float alpha;
    varying vec2 uv;
    void main () {
      vec3 col1 = texture2D(tex1, uv).rgb;
      vec3 col2 = texture2D(tex2, uv).rgb;
      gl_FragColor = vec4(2.0*abs(col1 - col2), 1.0);
    }
  `;
  params = [];
}

export class CommandRunnerTimes extends CommandRunnerRegl {
  arity = 1;
  frag = `
    precision mediump float;
    uniform sampler2D tex1;
    uniform float alpha;
    varying vec2 uv;
    void main () {
      vec3 col1 = texture2D(tex1, uv).rgb;
      gl_FragColor = vec4(col1 * alpha, 1.0);
    }
  `;
  params = ["alpha"];
}

class CommandRunnerCopy extends CommandRunnerFromStack {
  fbo: Fbo | undefined = undefined;

  runFromStack(stack: Value[]): Value {
    const { regl } = this.ctx;
    const input = stack[stack.length - 1];
    assert(input.type === "texture");
    // omg why doesn't this work
    if (!this.fbo) this.fbo = Fbo(regl);
    // this crashes everything
    // this.fbo = Fbo(regl);
    if (
      input.texture.width !== this.fbo.texture.width ||
      input.texture.height !== this.fbo.texture.height
    ) {
      console.log("resizing");
      this.fbo.resize(input.texture.width, input.texture.height);
    }

    this.fbo.use(() => {
      const passthrough = regl({
        frag: `
          precision mediump float;
          uniform sampler2D tex1;
          varying vec2 uv;
          void main() {
            gl_FragColor = texture2D(tex1, uv);
          }
        `,
        vert: `
          precision mediump float;
          attribute vec2 position;
          varying vec2 uv;
          void main() {
            uv = 0.5 * (position + 1.0);
            gl_Position = vec4(position, 0, 1);
          }
        `,
        attributes: {
          position: [-1, -1, 1, -1, -1, 1, 1, 1],
        },
        elements: [
          [0, 1, 2],
          [2, 1, 3],
        ],
        uniforms: {
          tex1: input.texture,
        },
      });
      passthrough();
    });
    return { type: "texture", texture: this.fbo.texture };
  }
}

class CommandRunnerDelay extends CommandRunnerFromStack {
  fbos: Fbo[] = [];

  runFromStack(stack: Value[]): Value {
    const { regl, copy } = this.ctx;
    const input = stack[stack.length - 1];
    assert(input.type === "texture");
    const delayLength = this.parameterValues["Length"];
    assert(delayLength > 0, "length 0 not impl");
    if (this.fbos.length < delayLength) {
      const newFBO = Fbo(regl);
      this.fbos.push(newFBO);
      throw new Error("not ready yet");
    } else {
      // get rid of extraneous textures
      while (this.fbos.length > delayLength) {
        this.fbos.shift()!.destroy();
      }

      // cycle the ring
      const oldFbo = this.fbos.shift()!; // we've already returned this one! re-use it
      oldFbo.resize(input.texture.width, input.texture.height);
      copy({
        tex1: input.texture,
        framebuffer: oldFbo,
      });
      this.fbos.push(oldFbo);

      return { type: "texture", texture: this.fbos.at(-1)!.texture };
    }
  }
}

export type ProgramRunner = CommandRunner[];

export type ProgramResult = {
  intermediate: { [id: string]: CommandResult };
  final: Value;
};

export function runProgramRunner(
  programRunner: ProgramRunner,
  input: Value,
): ProgramState {
  let state: ProgramState = {
    type: "active",
    intermediate: {},
    stack: [input],
    vars: {},
  };
  for (const commandRunner of programRunner) {
    state = commandRunner.run(state);
  }
  return state;
}

export type ParseResult = { programRunner: ProgramRunner; error?: unknown };

export function parseToProgramRunner(
  code: string,
  oldProgramRunner: ProgramRunner | undefined,
  ctx: OmniCanvasContext,
): ParseResult {
  let programRunner: ProgramRunner = [];
  try {
    for (const [lineIdx, line] of code.split("\n").entries()) {
      const lineNum = lineIdx + 1; // 1-based line numbers

      if (oldProgramRunner) {
        const oldCommandRunner = oldProgramRunner[programRunner.length];
        if (oldCommandRunner && line === oldCommandRunner.originalLine) {
          oldCommandRunner.lineNum = lineNum; // TODO: sucks
          programRunner.push(oldCommandRunner);
          continue;
        }
      }
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parts = trimmed.split(/\s+/);
      const command = parts[0].toLowerCase();
      const args = parts.slice(1);
      const id = programRunner.length.toString();
      if (command === "->") {
        assert(args.length === 1, "'save' requires one argument");
        programRunner.push(
          new CommandRunnerSaveToVar(
            id,
            lineNum,
            { varName: args[0] },
            line,
            ctx,
          ),
        );
      }
      if (command === "<-") {
        assert(args.length === 1, "'load' requires one argument");
        programRunner.push(
          new CommandRunnerLoadFromVar(
            id,
            lineNum,
            { varName: args[0] },
            line,
            ctx,
          ),
        );
      } else if (command === "delay") {
        assert(args.length === 1, "'delay' requires one argument");
        programRunner.push(
          new CommandRunnerDelay(
            id,
            lineNum,
            { Length: parseFloat(args[0]) },
            line,
            ctx,
          ),
        );
      } else if (command === "blend") {
        assert(args.length === 1, "'blend' requires one argument");
        programRunner.push(
          new CommandRunnerBlend(
            id,
            lineNum,
            { alpha: parseFloat(args[0]) },
            line,
            ctx,
          ),
        );
      } else if (command === "-") {
        assert(args.length === 0, "'-' does not take arguments");
        programRunner.push(new CommandRunnerMinus(id, lineNum, {}, line, ctx));
      } else if (command === "iden") {
        assert(args.length === 0, "'iden' does not take arguments");
        programRunner.push(new CommandRunnerIden(id, lineNum, {}, line, ctx));
      } else if (command === "copy") {
        assert(args.length === 0, "'copy' does not take arguments");
        programRunner.push(new CommandRunnerCopy(id, lineNum, {}, line, ctx));
      } else if (command === "*") {
        assert(args.length === 1, "'minus' requires one argument");
        programRunner.push(
          new CommandRunnerTimes(
            id,
            lineNum,
            { alpha: parseFloat(args[0]) },
            line,
            ctx,
          ),
        );
      } else {
        throw new Error(`I don't understand '${command}'`);
      }
    }
    console.log("programRunner", programRunner);
    return { programRunner };
  } catch (e) {
    console.error("Error parsing code to filter chain:", e);
    return { programRunner, error: e };
  }
}
