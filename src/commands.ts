import _ from "lodash";
import reglConstructor, { DrawCommand, Regl, Texture2D } from "regl";
import { assert } from "./assert.js";
import dims from "./dims.js";
import * as glfx from "./glfx/lib.js";
import { GlfxCanvas, GlfxTexture } from "./glfx/lib.js";

export type ParameterValues = { [parameterName: string]: any };

export type Value = {
  type: "image";
  source: HTMLCanvasElement | HTMLVideoElement;
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
      message: string;
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
  ) {}

  abstract run(state: ProgramState): ProgramState;
}

function cloneCanvas(
  source: HTMLCanvasElement | HTMLVideoElement,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not get canvas context");
  ctx.drawImage(source, 0, 0);
  return canvas;
}

export class CommandRunnerSaveToVar extends CommandRunner {
  glfxResources: GlfxResources | undefined = undefined;

  run(state: ProgramState): ProgramState {
    const varName = this.parameterValues["varName"];
    if (state.type === "error") return state;
    const value = state.stack[state.stack.length - 1];
    const glfxResources = (this.glfxResources = updateGlfxResources(
      this.glfxResources,
      value.source,
    ));
    glfxResources.canvas.draw(glfxResources.texture);
    glfxResources.canvas.update();
    return {
      ...state,
      vars: {
        ...state.vars,
        [varName]: { type: "image", source: glfxResources.canvas },
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
        [this.id]: state.vars[varName],
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
    } catch (e) {
      let message: string;
      if (e instanceof Error) {
        message = e.message;
      } else {
        message = "unknown error; logging";
        console.error(e);
      }
      const result: CommandResult = { type: "error", message };
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
    | {
        canvas: HTMLCanvasElement;
        textures: Texture2D[];
        draw: DrawCommand;
        regl: Regl;
      }
    | undefined = undefined;

  abstract get arity(): number;
  abstract get frag(): string;
  abstract get params(): string[];

  runFromStack(stack: Value[]): Value {
    // console.log("running regl command, lineNum = ", this.lineNum);
    const arity = this.arity;
    const inputs = stack.slice(-arity);

    if (!this.resources) {
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = dims(inputs[0].source);
      const regl = reglConstructor({ canvas });
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
      const textures = inputs.map((input) =>
        regl.texture({
          data: input.source,
          flipY: true,
        }),
      );
      this.resources = {
        canvas,
        textures,
        draw,
        regl,
      };
    } else {
      this.resources.textures.forEach((texture, i) => {
        texture({
          data: inputs[i].source,
          flipY: true,
        });
      });
    }

    const { canvas, textures, draw, regl } = this.resources;

    regl.poll();
    draw({
      ...this.parameterValues,
      ...Object.fromEntries(textures.map((tex, i) => [`tex${i + 1}`, tex])),
    });
    return { type: "image", source: canvas };
  }
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

export interface GlfxResources {
  canvas: GlfxCanvas;
  texture: GlfxTexture;
}

export function updateGlfxResources(
  glfxResources: GlfxResources | undefined,
  textureSource: HTMLVideoElement | HTMLCanvasElement,
): GlfxResources {
  // set to "true" means we always create new resources; a way to
  // test how important persistence / keys are
  const alwaysRecreate = false;
  if (!glfxResources || alwaysRecreate) {
    const canvas = glfx.canvas();
    const texture = canvas.texture(textureSource);
    glfxResources = { canvas, texture };
  } else {
    try {
      glfxResources.texture.loadContentsOf(textureSource);
    } catch {
      console.warn("trouble loading texture; let's try again");
      glfxResources.texture.destroy();
      glfxResources = undefined;
      return updateGlfxResources(glfxResources, textureSource);
    }
  }
  return glfxResources;
}

export abstract class CommandRunnerGlfx extends CommandRunnerFromStack {
  glfxResources: GlfxResources | undefined;

  runFromStack(stack: Value[]): Value {
    const input = stack[stack.length - 1];
    if (input.type !== "image") {
      throw new Error(`needs image input, not ${input.type}`);
    }

    const glfxResources = (this.glfxResources = updateGlfxResources(
      this.glfxResources,
      input.source,
    ));

    glfxResources.canvas.draw(glfxResources.texture);
    this.apply(glfxResources.canvas);
    glfxResources.canvas.update();
    return { type: "image", source: glfxResources.canvas };
  }

  abstract apply(this: this, canvas: GlfxCanvas): void;
}

class CommandRunnerBlur extends CommandRunnerGlfx {
  apply(canvas: GlfxCanvas) {
    canvas.triangleBlur(this.parameterValues["Distance"]);
  }
}

class CommandRunnerBC extends CommandRunnerGlfx {
  apply(canvas: GlfxCanvas) {
    canvas.brightnessContrast(
      this.parameterValues["Brightness"],
      this.parameterValues["Contrast"],
    );
  }
}

class CommandRunnerDelay extends CommandRunnerFromStack {
  canvas = glfx.canvas();
  textures: GlfxTexture[] = [];

  runFromStack(stack: Value[]): Value {
    const input = stack[stack.length - 1];
    assert(input.type === "image");
    const delayLength = this.parameterValues["Length"];
    assert(delayLength > 0, "length 0 not impl");
    if (this.textures.length < delayLength) {
      const newTexture = this.canvas.texture(input.source);
      this.textures.push(newTexture);
      throw new Error("still loading");
    } else {
      // get rid of extraneous textures
      while (this.textures.length > delayLength) {
        this.textures.shift()!.destroy();
      }

      // draw onto the canvas
      const oldTexture = this.textures.shift()!;
      this.canvas.draw(oldTexture);
      this.canvas.update();

      // update with new info
      oldTexture.loadContentsOf(input.source);
      this.textures.push(oldTexture);

      return { type: "image", source: this.canvas };
    }
  }
}

export const commandRunners: { [name: string]: typeof CommandRunner } = {
  blur: CommandRunnerBlur,
  bc: CommandRunnerBC,
};

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
  oldProgramRunner?: ProgramRunner,
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
          new CommandRunnerSaveToVar(id, lineNum, { varName: args[0] }, line),
        );
      }
      if (command === "<-") {
        assert(args.length === 1, "'load' requires one argument");
        programRunner.push(
          new CommandRunnerLoadFromVar(id, lineNum, { varName: args[0] }, line),
        );
      } else if (command === "blur") {
        assert(args.length === 1, "'blur' requires one argument");
        programRunner.push(
          new CommandRunnerBlur(
            id,
            lineNum,
            { Distance: parseFloat(args[0]) },
            line,
          ),
        );
      } else if (command === "bc") {
        assert(args.length === 2, "'bc' requires two arguments");
        programRunner.push(
          new CommandRunnerBC(
            id,
            lineNum,
            { Brightness: parseFloat(args[0]), Contrast: parseFloat(args[1]) },
            line,
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
          ),
        );
      } else if (command === "-") {
        assert(args.length === 0, "'minus' does not take arguments");
        programRunner.push(new CommandRunnerMinus(id, lineNum, {}, line));
      } else if (command === "*") {
        assert(args.length === 1, "'minus' requires one argument");
        programRunner.push(
          new CommandRunnerTimes(
            id,
            lineNum,
            { alpha: parseFloat(args[0]) },
            line,
          ),
        );
      } else {
        throw new Error(`I don't understand '${command}'`);
      }
    }
    return { programRunner };
  } catch (e) {
    console.error("Error parsing code to filter chain:", e);
    return { programRunner, error: e };
  }
}
