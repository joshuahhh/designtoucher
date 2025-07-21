import _ from "lodash";
import { assert } from "./assert.js";
import {
  deleteFbo,
  ensureFboSize,
  Fbo,
  newFbo,
  ShaderProgram,
  Tex,
} from "./mygl.js";
import { OmniCanvasContextType } from "./OmniCanvas.js";
import { popFront, pushBack, pushFront } from "./util.js";

export type TextureValue = {
  type: "texture";
  tex: Tex;
};

export type Value = TextureValue; // | … other kinds later

export type CommandResult =
  | Value
  | {
      type: "error";
      error: Error;
    };

export type ProgramState =
  | {
      type: "active";
      vars: Record<string, Value>;
      stack: Value[];
      intermediate: Record<string, CommandResult>;
    }
  | {
      type: "error";
      intermediate: Record<string, CommandResult>;
    };

export type ParameterValues = Record<string, unknown>;

type CommandRunnerConstructorProps = {
  id: string;
  lineNum: number;
  parameterValues: ParameterValues;
  originalLine: string;
  ctx: OmniCanvasContextType;
};

export abstract class CommandRunner implements CommandRunnerConstructorProps {
  id: string;
  lineNum: number;
  parameterValues: ParameterValues;
  originalLine: string;
  ctx: OmniCanvasContextType;

  constructor(props: CommandRunnerConstructorProps) {
    this.id = props.id;
    this.lineNum = props.lineNum;
    this.parameterValues = props.parameterValues;
    this.originalLine = props.originalLine;
    this.ctx = props.ctx;
  }

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

/* ------------------------------------------------------------------
 * Helpers: single‑value stack ops, variable save/load
 * ---------------------------------------------------------------- */
// export class CommandRunnerSaveToVar extends CommandRunner {
//   private resources?: { tex: WebGLTexture; fb: WebGLFramebuffer };

//   run(state: ProgramState): ProgramState {
//     if (state.type === "error") return state;
//     const input = state.stack[state.stack.length - 1];
//     const { gl, draw } = this.ctx;
//     assert(input.type === "texture");

//     // lazy allocate dest texture+FBO
//     if (!this.resources) {
//       const tex = gl.createTexture()!;
//       gl.bindTexture(gl.TEXTURE_2D, tex);
//       gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
//       gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
//       const fb = gl.createFramebuffer()!;
//       gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
//       gl.framebufferTexture2D(
//         gl.FRAMEBUFFER,
//         gl.COLOR_ATTACHMENT0,
//         gl.TEXTURE_2D,
//         tex,
//         0,
//       );
//       this.resources = { tex, fb };
//     }

//     const { tex, fb } = this.resources;

//     // resize dest texture if needed
//     if (
//       input.tex.width !== this.parameterValues.__w ||
//       input.tex.height !== this.parameterValues.__h
//     ) {
//       gl.bindTexture(gl.TEXTURE_2D, tex);
//       gl.texImage2D(
//         gl.TEXTURE_2D,
//         0,
//         gl.RGBA,
//         input.tex.width,
//         input.tex.height,
//         0,
//         gl.RGBA,
//         gl.UNSIGNED_BYTE,
//         null,
//       );
//       this.parameterValues.__w = input.tex.width;
//       this.parameterValues.__h = input.tex.height;
//     }

//     // copy input texture → framebuffer (tex)
//     draw({ texture: input.tex.texture, targetFramebuffer: fb });

//     const varName = String(this.parameterValues["varName"]);
//     return {
//       ...state,
//       vars: {
//         ...state.vars,
//         [varName]: { type: "texture", tex },
//       },
//     };
//   }
// }

export class CommandRunnerLoadFromVar extends CommandRunner {
  run(state: ProgramState): ProgramState {
    if (state.type === "error") return state;
    const varName = String(this.parameterValues["varName"]);
    const val = state.vars[varName];
    return {
      ...state,
      stack: [...state.stack, val],
      intermediate: { ...state.intermediate, [this.id]: val },
    };
  }
}

/* ------------------------------------------------------------------
 * Base class for commands that pop N textures, push 1 texture
 * implemented with a tiny custom fragment shader
 * ---------------------------------------------------------------- */
abstract class CommandRunnerGL extends CommandRunner {
  private program: ShaderProgram;
  private quadVbo: WebGLBuffer;
  private indexBuffer: WebGLBuffer;
  private outFbo: Fbo;

  constructor(
    props: CommandRunnerConstructorProps,
    public arity: number,
    public fragBody: string,
    public params: string[],
  ) {
    super(props);

    const { gl } = this.ctx;

    const fragSrc =
      `precision mediump float;\n` +
      this.params.map((p) => `uniform float ${p};`).join("\n") +
      _.range(this.arity)
        .map((i) => `uniform sampler2D tex${i + 1};`)
        .join("\n") +
      `\nvarying vec2 uv;\nvoid main(){\n${this.fragBody}\n}`;
    const vertSrc = `
      attribute vec2 position; varying vec2 uv;
      void main(){ uv = 0.5*(position+1.0); gl_Position = vec4(position,0.0,1.0); }
    `;
    this.program = new ShaderProgram(gl, vertSrc, fragSrc);

    // quad
    this.quadVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
      gl.STATIC_DRAW,
    );

    this.indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 2, 2, 3, 0]),
      gl.STATIC_DRAW,
    );

    this.outFbo = undefined as any; // will be set in ensureOut()
    this.ensureOut(gl, 1, 1); // initial dummy FBO
  }

  /** ensure reusable output framebuffer sized to w×h */
  private ensureOut(gl: WebGLRenderingContext, w: number, h: number) {
    if (!this.outFbo) {
      this.outFbo = newFbo(gl);
    }

    ensureFboSize(this.outFbo, w, h);
  }

  run(state: ProgramState): ProgramState {
    if (state.type === "error") return state;
    const { gl } = this.ctx;

    // pop inputs
    const inputs = state.stack.slice(-this.arity) as TextureValue[];
    const width = inputs[0].tex.width;
    const height = inputs[0].tex.height;

    this.ensureOut(gl, width, height);

    this.program.run({
      viewport: [0, 0, width, height],
      uniforms: {
        ...Object.fromEntries(
          this.params.map((p) => [
            p,
            ["1f", Number(this.parameterValues[p] ?? 0)],
          ]),
        ),
        ...Object.fromEntries(
          inputs.map((value, i) => [
            `tex${i + 1}`,
            ["sampler2D", value.tex.texture],
          ]),
        ),
      },
      attributes: {
        position: this.quadVbo,
      },
      index: {
        buffer: this.indexBuffer,
        count: 6,
      },
      targetFramebuffer: this.outFbo.framebuffer,
    });

    const out: TextureValue = { type: "texture", tex: this.outFbo.tex };

    return {
      ...state,
      stack: [...state.stack, out],
      intermediate: { ...state.intermediate, [this.id]: out },
    };
  }
}

/* ------------------------------------------------------------------
 * Concrete GL commands (iden, blend, minus, times)
 * ---------------------------------------------------------------- */
export class CommandRunnerIden extends CommandRunnerGL {
  constructor(props: CommandRunnerConstructorProps) {
    super(props, 1, "gl_FragColor = texture2D(tex1, uv);", []);
  }
}

export class CommandRunnerBlend extends CommandRunnerGL {
  constructor(props: CommandRunnerConstructorProps) {
    super(
      props,
      2,
      `
        vec3 col1 = texture2D(tex1, uv).rgb;
        vec3 col2 = texture2D(tex2, uv).rgb;
        gl_FragColor = vec4(mix(col2, col1, alpha), 1.0);
      `,
      ["alpha"],
    );
  }
}

export class CommandRunnerMinus extends CommandRunnerGL {
  constructor(props: CommandRunnerConstructorProps) {
    super(
      props,
      2,
      `
        vec3 c1 = texture2D(tex1, uv).rgb;
        vec3 c2 = texture2D(tex2, uv).rgb;
        gl_FragColor = vec4(abs(c1 - c2), 1.0);
      `,
      [],
    );
  }
}

export class CommandRunnerTimes extends CommandRunnerGL {
  constructor(props: CommandRunnerConstructorProps) {
    super(
      props,
      2,
      `
        vec3 c1 = texture2D(tex1, uv).rgb;
        vec3 c2 = texture2D(tex2, uv).rgb;
        gl_FragColor = vec4(c1 * c2 * alpha, 1.0);
      `,
      ["alpha"],
    );
  }
}

export class CommandRunnerCopy extends CommandRunnerGL {
  constructor(props: CommandRunnerConstructorProps) {
    super(
      props,
      1,
      `
        gl_FragColor = texture2D(tex1, uv);
      `,
      [],
    );
  }
}

export class CommandRunnerGrayscale extends CommandRunnerGL {
  // make it grayscale
  constructor(props: CommandRunnerConstructorProps) {
    super(
      props,
      1,
      `
        vec4 color = texture2D(tex1, uv);
        float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor = vec4(vec3(gray), 1.0);
      `,
      [],
    );
  }
}

export class CommandRunnerBC extends CommandRunnerGL {
  constructor(props: CommandRunnerConstructorProps) {
    super(
      props,
      1,
      `
        vec4 color = texture2D(texture, texCoord);
        color.rgb += brightness;
        if (contrast > 0.0) {
            color.rgb = (color.rgb - 0.5) / (1.0 - contrast) + 0.5;
        } else {
            color.rgb = (color.rgb - 0.5) * (1.0 + contrast) + 0.5;
        }
        gl_FragColor = color;
      `,
      [],
    );
  }
}

export class CommandRunnerFlip extends CommandRunnerGL {
  constructor(props: CommandRunnerConstructorProps) {
    super(
      props,
      1,
      `
        vec2 uvFlip = vec2(uv.x, 1.0 - uv.y);
        gl_FragColor = texture2D(tex1, uvFlip);
      `,
      [],
    );
  }
}

class CommandRunnerDelay extends CommandRunnerFromStack {
  fbos: Fbo[] = [];

  /*
  the ring will always have size one greater than the delay length.
  the entry at the very front of the ring is the one that will be
  returned. on the next tick, it will go to the back of the ring and
  get overwritten. (so you better not hold onto it for more than the
  tick!)

  suppose length is 3. fbos: [A, B, C, D] – meaning A is oldest, D is
  newest. we cycle A to the back, overwrite it, and return B.

  what if the cycle isn't big enough yet, like it's just [A, B]? then
  we want to push to the back.

  so the common logic is:
  - if ring is too short, push a new FBO to the front
  - no matter what, cycle front to the back and overwrite it
  - if ring isn't too short, return the front
  */

  runFromStack(stack: Value[]): Value {
    const { gl, draw } = this.ctx;
    const input = stack[stack.length - 1];
    assert(input.type === "texture");
    const ringLength = (this.parameterValues["Length"] as number) + 1;

    if (this.fbos.length < ringLength) {
      console.log("delay: lengthening ring");
      pushFront(this.fbos, newFbo(gl));
    }

    // get rid of extraneous textures
    while (this.fbos.length > ringLength) {
      console.log("delay: shortening");
      deleteFbo(popFront(this.fbos)!);
    }

    // cycle the ring
    const oldestFbo = popFront(this.fbos)!;
    ensureFboSize(oldestFbo, input.tex.width, input.tex.height);
    draw({
      texture: input.tex.texture,
      targetFramebuffer: oldestFbo.framebuffer,
      viewport: [0, 0, input.tex.width, input.tex.height],
    });
    pushBack(this.fbos, oldestFbo);

    if (this.fbos.length < ringLength) {
      throw new Error("Delay ring not long enough");
    }

    return { type: "texture", tex: this.fbos[0].tex };
  }
}

/* ------------------------------------------------------------------
 * Program runner utilities (unchanged API)
 * ---------------------------------------------------------------- */
export type ProgramRunner = CommandRunner[];

export function runProgramRunner(
  programRunner: ProgramRunner,
  input: TextureValue,
): ProgramState {
  let state: ProgramState = {
    type: "active",
    vars: {},
    stack: [input],
    intermediate: {},
  };
  for (const cr of programRunner) state = cr.run(state);
  return state;
}

/* ------------------------------------------------------------------
 * Parsing helpers – unchanged except that they now build GL runners
 * ---------------------------------------------------------------- */
export type ParseResult = { programRunner: ProgramRunner; error?: unknown };

export function parseToProgramRunner(
  code: string,
  oldProgramRunner: ProgramRunner | undefined,
  ctx: OmniCanvasContextType,
): ParseResult {
  let programRunner: ProgramRunner = [];
  try {
    for (const [idx, line] of code.split("\n").entries()) {
      const lineNum = idx + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [cmd, ...args] = trimmed.split(/\s+/);
      const id = String(programRunner.length);

      // reuse unchanged runner if line identical (hot‑swap optimisation)
      if (
        oldProgramRunner &&
        oldProgramRunner[idx] &&
        oldProgramRunner[idx].originalLine === line
      ) {
        oldProgramRunner[idx].lineNum = lineNum;
        programRunner.push(oldProgramRunner[idx]);
        continue;
      }

      const props = {
        id,
        lineNum,
        originalLine: line,
        ctx,
      } satisfies Partial<CommandRunnerConstructorProps>;

      switch (cmd.toLowerCase()) {
        // case "->":
        //   assert(args.length === 1, "save needs var name");
        //   programRunner.push(
        //     new CommandRunnerSaveToVar({
        //       ...props,
        //       parameterValues: {
        //         varName: args[0],
        //       },
        //     }),
        //   );
        //   break;
        case "<-":
          assert(args.length === 1, "load needs var name");
          programRunner.push(
            new CommandRunnerLoadFromVar({
              ...props,
              parameterValues: {
                varName: args[0],
              },
            }),
          );
          break;
        case "delay":
          assert(args.length === 1);
          programRunner.push(
            new CommandRunnerDelay({
              ...props,
              parameterValues: {
                Length: Number(args[0]),
              },
            }),
          );
          break;
        case "blend":
          assert(args.length === 1);
          programRunner.push(
            new CommandRunnerBlend({
              ...props,
              parameterValues: {
                alpha: Number(args[0]),
              },
            }),
          );
          break;
        case "-":
          programRunner.push(
            new CommandRunnerMinus({
              ...props,
              parameterValues: {},
            }),
          );
          break;
        case "iden":
          programRunner.push(
            new CommandRunnerIden({
              ...props,
              parameterValues: {},
            }),
          );
          break;
        case "copy":
          programRunner.push(
            new CommandRunnerCopy({
              ...props,
              parameterValues: {},
            }),
          );
          break;
        case "flip":
          programRunner.push(
            new CommandRunnerFlip({
              ...props,
              parameterValues: {},
            }),
          );
          break;
        case "gray":
          programRunner.push(
            new CommandRunnerGrayscale({
              ...props,
              parameterValues: {},
            }),
          );
          break;
        case "*":
          assert(args.length === 1);
          programRunner.push(
            new CommandRunnerTimes({
              ...props,
              parameterValues: {
                alpha: Number(args[0]),
              },
            }),
          );
          break;
        default:
          throw new Error(`Unknown command '${cmd}'`);
      }
    }
    return { programRunner };
  } catch (error) {
    console.error("parse error", error);
    return { programRunner, error };
  }
}
