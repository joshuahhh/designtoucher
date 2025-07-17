import _ from "lodash";
import { createProgram, OmniCanvasContextType } from "./OmniCanvas.js";
import { assert } from "./assert.js";
import { Fbo } from "./fbo.js"; // NOTE: fbo.ts must be rewritten to take a WebGLRenderingContext, not regl

/* ------------------------------------------------------------------
 * Value/Program‑runner types (no regl)
 * ---------------------------------------------------------------- */
export type TextureValue = {
  type: "texture";
  texture: WebGLTexture;
  width: number;
  height: number;
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

/* ------------------------------------------------------------------
 * Base command‑runner class hierarchy
 * ---------------------------------------------------------------- */
export abstract class CommandRunner {
  constructor(
    public id: string,
    public lineNum: number,
    public parameterValues: ParameterValues,
    public originalLine: string,
    public ctx: OmniCanvasContextType, // supplies gl + helpers
  ) {}

  abstract run(state: ProgramState): ProgramState;
}

/* ------------------------------------------------------------------
 * Helpers: single‑value stack ops, variable save/load
 * ---------------------------------------------------------------- */
export class CommandRunnerSaveToVar extends CommandRunner {
  private resources?: { tex: WebGLTexture; fb: WebGLFramebuffer };

  run(state: ProgramState): ProgramState {
    if (state.type === "error") return state;
    const input = state.stack[state.stack.length - 1];
    const { gl, copy } = this.ctx;
    assert(input.type === "texture");

    // lazy allocate dest texture+FBO
    if (!this.resources) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        tex,
        0,
      );
      this.resources = { tex, fb };
    }

    const { tex, fb } = this.resources;

    // resize dest texture if needed
    if (
      input.width !== this.parameterValues.__w ||
      input.height !== this.parameterValues.__h
    ) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        input.width,
        input.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      this.parameterValues.__w = input.width;
      this.parameterValues.__h = input.height;
    }

    // copy input texture → framebuffer (tex)
    copy({ texture: input.texture, framebuffer: fb });

    const varName = String(this.parameterValues["varName"]);
    return {
      ...state,
      vars: {
        ...state.vars,
        [varName]: {
          type: "texture",
          texture: tex,
          width: input.width,
          height: input.height,
        },
      },
    };
  }
}

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
  private program?: WebGLProgram;
  private quadVbo?: WebGLBuffer;
  private texLocations?: WebGLUniformLocation[];
  private paramLocations?: Record<string, WebGLUniformLocation>;
  private outFbo?: {
    tex: WebGLTexture;
    fb: WebGLFramebuffer;
    w: number;
    h: number;
  };

  /** how many textures popped from stack */
  abstract readonly arity: number;
  /** fragment‑shader body (receives uniforms tex1…texN + params) */
  abstract readonly fragBody: string;
  /** list of numeric uniforms pulled from parameterValues */
  abstract readonly params: string[];

  private init(gl: WebGLRenderingContext) {
    if (this.program) return;
    // full fragment shader
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
    this.program = createProgram(gl, vertSrc, fragSrc);

    // quad
    this.quadVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    // uniforms
    this.texLocations = _.range(this.arity).map(
      (i) => gl.getUniformLocation(this.program!, `tex${i + 1}`)!,
    );
    this.paramLocations = Object.fromEntries(
      this.params.map((p) => [p, gl.getUniformLocation(this.program!, p)!]),
    );
  }

  /** ensure reusable output framebuffer sized to w×h */
  private ensureOut(gl: WebGLRenderingContext, w: number, h: number) {
    if (this.outFbo && this.outFbo.w === w && this.outFbo.h === h) return;
    if (this.outFbo) {
      gl.deleteFramebuffer(this.outFbo.fb);
      gl.deleteTexture(this.outFbo.tex);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    this.outFbo = { tex, fb, w, h };
  }

  run(state: ProgramState): ProgramState {
    if (state.type === "error") return state;
    const { gl } = this.ctx;

    // pop inputs
    const inputs = state.stack.slice(-this.arity) as TextureValue[];
    const width = inputs[0].width;
    const height = inputs[0].height;

    this.init(gl);
    this.ensureOut(gl, width, height);

    // set viewport to full texture size
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFbo!.fb);
    gl.viewport(0, 0, width, height);

    gl.useProgram(this.program!);

    // attributes
    const posLoc = gl.getAttribLocation(this.program!, "position");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo!);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // uniforms – textures
    inputs.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.uniform1i(this.texLocations![i], i);
    });

    // numeric params
    this.params.forEach((p) => {
      gl.uniform1f(
        this.paramLocations![p],
        Number(this.parameterValues[p] ?? 0),
      );
    });

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // restore default FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const out: TextureValue = {
      type: "texture",
      texture: this.outFbo!.tex,
      width,
      height,
    };

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
  readonly arity = 1;
  readonly fragBody = "gl_FragColor = texture2D(tex1, uv);";
  readonly params: string[] = [];
}

export class CommandRunnerBlend extends CommandRunnerGL {
  readonly arity = 2;
  readonly fragBody = `
    vec3 col1 = texture2D(tex1, uv).rgb;
    vec3 col2 = texture2D(tex2, uv).rgb;
    gl_FragColor = vec4(mix(col2, col1, alpha), 1.0);
  `;
  readonly params = ["alpha"];
}

export class CommandRunnerMinus extends CommandRunnerGL {
  readonly arity = 2;
  readonly fragBody = `
    vec3 c1 = texture2D(tex1, uv).rgb;
    vec3 c2 = texture2D(tex2, uv).rgb;
    gl_FragColor = vec4(abs(c1 - c2) * 2.0, 1.0);
  `;
  readonly params: string[] = [];
}

export class CommandRunnerTimes extends CommandRunnerGL {
  readonly arity = 1;
  readonly fragBody = `
    vec3 c = texture2D(tex1, uv).rgb * alpha;
    gl_FragColor = vec4(c, 1.0);
  `;
  readonly params = ["alpha"];
}

export class CommandRunnerCopy extends CommandRunnerGL {
  readonly arity = 1;
  readonly fragBody = "gl_FragColor = texture2D(tex1, uv);";
  readonly params: string[] = [];
}

/* ------------------------------------------------------------------
 * Copy / Delay commands (re‑implemented with ctx.copy helper)
 * ---------------------------------------------------------------- */
class CommandRunnerCopy2 extends CommandRunner {
  private fbo?: ReturnType<typeof Fbo>;

  run(state: ProgramState): ProgramState {
    if (state.type === "error") return state;
    const input = state.stack[state.stack.length - 1];
    assert(input.type === "texture");
    const { gl, copy } = this.ctx;

    if (!this.fbo) this.fbo = Fbo(gl);

    if (input.width !== this.fbo.width || input.height !== this.fbo.height) {
      this.fbo.resize(input.width, input.height);
    }

    copy({ texture: input.texture, framebuffer: this.fbo.fb });

    const out: TextureValue = {
      type: "texture",
      texture: this.fbo.tex,
      width: input.width,
      height: input.height,
    };

    return {
      ...state,
      stack: [...state.stack, out],
      intermediate: { ...state.intermediate, [this.id]: out },
    };
  }
}

class CommandRunnerDelay extends CommandRunner {
  private fbos: ReturnType<typeof Fbo>[] = [];

  run(state: ProgramState): ProgramState {
    if (state.type === "error") return state;
    const input = state.stack[state.stack.length - 1];
    assert(input.type === "texture");

    const delayLen = Number(this.parameterValues["Length"]);
    assert(delayLen > 0, "Length must be >0");

    const { gl, copy } = this.ctx;

    // grow to required length
    while (this.fbos.length < delayLen) this.fbos.push(Fbo(gl));
    while (this.fbos.length > delayLen) this.fbos.shift()!.destroy();

    // rotate ring buffer
    const fb = this.fbos.shift()!;
    fb.resize(input.width, input.height);
    copy({ texture: input.texture, framebuffer: fb.fb });
    this.fbos.push(fb);

    const out: TextureValue = {
      type: "texture",
      texture: fb.tex,
      width: input.width,
      height: input.height,
    };

    return {
      ...state,
      stack: [...state.stack, out],
      intermediate: { ...state.intermediate, [this.id]: out },
    };
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

      switch (cmd.toLowerCase()) {
        case "->":
          assert(args.length === 1, "save needs var name");
          programRunner.push(
            new CommandRunnerSaveToVar(
              id,
              lineNum,
              { varName: args[0] },
              line,
              ctx,
            ),
          );
          break;
        case "<-":
          assert(args.length === 1, "load needs var name");
          programRunner.push(
            new CommandRunnerLoadFromVar(
              id,
              lineNum,
              { varName: args[0] },
              line,
              ctx,
            ),
          );
          break;
        case "delay":
          assert(args.length === 1);
          programRunner.push(
            new CommandRunnerDelay(
              id,
              lineNum,
              { Length: Number(args[0]) },
              line,
              ctx,
            ),
          );
          break;
        case "blend":
          assert(args.length === 1);
          programRunner.push(
            new CommandRunnerBlend(
              id,
              lineNum,
              { alpha: Number(args[0]) },
              line,
              ctx,
            ),
          );
          break;
        case "-":
          programRunner.push(
            new CommandRunnerMinus(id, lineNum, {}, line, ctx),
          );
          break;
        case "iden":
          programRunner.push(new CommandRunnerIden(id, lineNum, {}, line, ctx));
          break;
        case "copy":
          programRunner.push(new CommandRunnerCopy(id, lineNum, {}, line, ctx));
          break;
        case "*":
          assert(args.length === 1);
          programRunner.push(
            new CommandRunnerTimes(
              id,
              lineNum,
              { alpha: Number(args[0]) },
              line,
              ctx,
            ),
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
