import { assert } from "./assert.js";
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

export abstract class CommandRunner {
  constructor(
    public id: string,
    public parameterValues: ParameterValues,
    public originalLine: string,
  ) {}

  abstract run(input: Value): Value;

  runProtected(input: Value): CommandResult {
    try {
      return this.run(input);
    } catch (e) {
      let message: string;
      if (e instanceof Error) {
        message = e.message;
      } else {
        message = "unknown error; logging";
        console.error(e);
      }
      return { type: "error", message };
    }
  }
}

interface GlfxResources {
  canvas: GlfxCanvas;
  texture: GlfxTexture;
}

export abstract class CommandRunnerGlfx extends CommandRunner {
  glfxResources: GlfxResources | undefined;

  run(input: Value): Value {
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

class CommandRunnerDelay extends CommandRunner {
  canvas = glfx.canvas();
  textures: GlfxTexture[] = [];

  run(input: Value): Value {
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
): ProgramResult {
  let value = input;
  let intermediate: { [id: string]: CommandResult } = {};
  for (const commandRunner of programRunner) {
    const result = commandRunner.runProtected(value);
    intermediate[commandRunner.id] = result;
    if (result.type === "error") {
      break;
    } else {
      value = result;
    }
  }
  return { intermediate, final: value };
}

export type ParseResult = { programRunner: ProgramRunner; error?: unknown };

export function parseToProgramRunner(code: string): ParseResult {
  let programRunner: ProgramRunner = [];
  try {
    for (const line of code.split("\n")) {
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
