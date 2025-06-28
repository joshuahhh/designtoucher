import reglConstructor, {
  DrawCommand,
  Regl,
  Texture2D,
  Texture2DOptions,
} from "regl";
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
    public parameterValues: ParameterValues,
    public originalLine: string,
  ) {}

  abstract run(state: ProgramState): ProgramState;
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

type BlendProps = { texture1: Texture2D; texture2: Texture2D; alpha: number };

export class CommandRunnerBlend extends CommandRunnerFromStack {
  resources:
    | {
        canvas: HTMLCanvasElement;
        texture1: Texture2D;
        texture2: Texture2D;
        draw: DrawCommand;
        regl: Regl;
      }
    | undefined = undefined;

  runFromStack(stack: Value[]): Value {
    const input1 = stack[stack.length - 1];
    const input2 = stack[stack.length - 2];
    const alpha = this.parameterValues["Alpha"];

    const texture1Opts: Texture2DOptions = {
      data: input1.source,
      flipY: true,
    };
    const texture2Opts: Texture2DOptions = {
      data: input2.source,
      flipY: true,
    };

    if (!this.resources) {
      const canvas = document.createElement("canvas");
      console.log(dims(input1.source));
      [canvas.width, canvas.height] = dims(input1.source);
      canvas.height = 1280;
      const regl = reglConstructor({ canvas });
      const draw = regl({
        frag: `
          precision mediump float;
          uniform sampler2D texture1, texture2;
          uniform float alpha;
          varying vec2 uv;
          void main () {
            vec3 col1 = texture2D(texture1, uv).rgb;
            vec3 col2 = texture2D(texture2, uv).rgb;
            gl_FragColor = vec4(col1 * alpha + col2 * (1.0 - alpha), 1.0);
          }`,
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
          texture1: regl.prop<BlendProps, "texture1">("texture1"),
          texture2: regl.prop<BlendProps, "texture2">("texture2"),
          alpha: regl.prop<BlendProps, "alpha">("alpha"),
        },
      });
      const texture1 = regl.texture(texture1Opts);
      const texture2 = regl.texture(texture2Opts);
      this.resources = {
        canvas,
        texture1,
        texture2,
        draw,
        regl,
      };
    } else {
      this.resources.texture1(texture1Opts);
      this.resources.texture2(texture2Opts);
    }

    const { canvas, texture1, texture2, draw, regl } = this.resources;

    regl.poll();
    draw({ texture1, texture2, alpha });
    return { type: "image", source: canvas };
  }
}

interface GlfxResources {
  canvas: GlfxCanvas;
  texture: GlfxTexture;
}

export abstract class CommandRunnerGlfx extends CommandRunnerFromStack {
  glfxResources: GlfxResources | undefined;

  runFromStack(stack: Value[]): Value {
    const input = stack[stack.length - 1];
    if (input.type !== "image") {
      throw new Error(`needs image input, not ${input.type}`);
    }

    const glfxResources = this.updateGlfxResources(input.source);
    glfxResources.canvas.draw(glfxResources.texture);
    this.apply(glfxResources.canvas);
    glfxResources.canvas.update();
    return { type: "image", source: glfxResources.canvas };
  }

  abstract apply(this: this, canvas: GlfxCanvas): void;

  updateGlfxResources(
    textureSource: HTMLVideoElement | HTMLCanvasElement,
  ): GlfxResources {
    // set to "true" means we always create new resources; a way to
    // test how important persistence / keys are
    const alwaysRecreate = false;
    if (!this.glfxResources || alwaysRecreate) {
      const canvas = glfx.canvas();
      const texture = canvas.texture(textureSource);
      this.glfxResources = { canvas, texture };
    } else {
      try {
        this.glfxResources.texture.loadContentsOf(textureSource);
      } catch {
        console.warn("trouble loading texture; let's try again");
        this.glfxResources.texture.destroy();
        this.glfxResources = undefined;
        return this.updateGlfxResources(textureSource);
      }
    }
    return this.glfxResources;
  }
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
    for (const line of code.split("\n")) {
      if (oldProgramRunner) {
        const oldCommandRunner = oldProgramRunner[programRunner.length];
        if (oldCommandRunner && line === oldCommandRunner.originalLine) {
          programRunner.push(oldCommandRunner);
          continue;
        }
      }
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parts = trimmed.split(/\s+/);
      const command = parts[0].toLowerCase();
      const args = parts.slice(1).map((arg) => parseFloat(arg));
      const id = programRunner.length.toString();
      if (command === "blur") {
        assert(args.length === 1, "'blur' requires one argument");
        programRunner.push(
          new CommandRunnerBlur(id, { Distance: args[0] }, line),
        );
      } else if (command === "bc") {
        assert(args.length === 2, "'bc' requires two arguments");
        programRunner.push(
          new CommandRunnerBC(
            id,
            { Brightness: args[0], Contrast: args[1] },
            line,
          ),
        );
      } else if (command === "delay") {
        assert(args.length === 1, "'delay' requires one argument");
        programRunner.push(
          new CommandRunnerDelay(id, { Length: args[0] }, line),
        );
      } else if (command === "blend") {
        assert(args.length === 1, "'blend' requires one argument");
        programRunner.push(
          new CommandRunnerBlend(id, { Alpha: args[0] }, line),
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
