import { assertNever } from "./assert.js";
import "./mylygia.js";
import { expandLygia } from "./mylygia.js";

declare global {
  interface WebGLProgram {
    _WebGLProgramBrand: true;
  }
  interface WebGLShader {
    _WebGLShaderBrand: true;
  }
  interface WebGLTexture {
    _WebGLTextureBrand: true;
  }
  interface WebGLBuffer {
    _WebGLBufferBrand: true;
  }
  interface WebGLFramebuffer {
    _WebGLFramebufferBrand: true;
  }
  interface WebGLUniformLocation {
    _WebGLUniformLocationBrand: true;
  }
}

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const sourceWithIncludes = expandLygia(source);
  // if (sourceWithIncludes !== source) {
  //   console.group(`Shader source with includes`);
  //   console.log(`BEFORE:\n${source}`);
  //   console.log(`AFTER:\n${sourceWithIncludes}`);
  //   console.groupEnd();
  // }
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, sourceWithIncludes);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const compileErrLog = gl.getShaderInfoLog(shader);
    throw new Error(
      `Shader compile error: ${compileErrLog || "Unknown error"}`,
    );
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string,
): WebGLProgram {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const linkErrLog = gl.getProgramInfoLog(program);
    throw new Error(`Program link error: ${linkErrLog || "Unknown error"}`);
  }
  return program;
}

type UniformType =
  | `${"1" | "2" | "3" | "4"}${"f" | "i"}${"v" | ""}`
  | "sampler2D"
  | "sampler3D";

function getTextureUnit(
  gl: WebGL2RenderingContext,
  textureIdx: number,
): number {
  if (textureIdx < 0 || textureIdx > 31) {
    throw new Error("Texture index must be between 0 and 31");
  }
  return (gl as any)[`TEXTURE${textureIdx}`];
}

function setUniform(
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation | null,
  type: UniformType,
  value: any,
  textureIdx: number,
  setTextureIdx: (idx: number) => void,
) {
  // console.log(`Setting uniform ${location} of type ${type} with value`, value);
  if (!location) return;
  switch (type) {
    case "1f":
      gl.uniform1f(location, value);
      break;
    case "2f":
      gl.uniform2f(location, ...(value as [number, number]));
      break;
    case "3f":
      gl.uniform3f(location, ...(value as [number, number, number]));
      break;
    case "4f":
      gl.uniform4f(location, ...(value as [number, number, number, number]));
      break;
    case "1i":
      gl.uniform1i(location, value);
      break;
    case "2i":
      gl.uniform2i(location, ...(value as [number, number]));
      break;
    case "3i":
      gl.uniform3i(location, ...(value as [number, number, number]));
      break;
    case "4i":
      gl.uniform4i(location, ...(value as [number, number, number, number]));
      break;
    case "1fv":
      gl.uniform1fv(location, value);
      break;
    case "2fv":
      gl.uniform2fv(location, value);
      break;
    case "3fv":
      gl.uniform3fv(location, value);
      break;
    case "4fv":
      gl.uniform4fv(location, value);
      break;
    case "1iv":
      gl.uniform1iv(location, value);
      break;
    case "2iv":
      gl.uniform2iv(location, value);
      break;
    case "3iv":
      gl.uniform3iv(location, value);
      break;
    case "4iv":
      gl.uniform4iv(location, value);
      break;
    case "sampler2D":
      const texture = value as WebGLTexture;
      gl.activeTexture(getTextureUnit(gl, textureIdx));
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(location, textureIdx);
      setTextureIdx(textureIdx + 1);
      break;
    case "sampler3D":
      const texture3D = value as WebGLTexture;
      gl.activeTexture(getTextureUnit(gl, textureIdx));
      gl.bindTexture(gl.TEXTURE_3D, texture3D);
      gl.uniform1i(location, textureIdx);
      setTextureIdx(textureIdx + 1);
      break;
    default:
      assertNever(type, "Unknown uniform type");
  }
}

export class ShaderProgram {
  program: WebGLProgram;
  fullscreenStuff: {
    quadBuffer: WebGLBuffer;
    indexBuffer: WebGLBuffer;
  } | null = null;

  constructor(
    private gl: WebGL2RenderingContext,
    vsSource: string,
    fsSource: string,
  ) {
    // we trim so that directives like `#version` don't cause issues
    this.program = createProgram(gl, vsSource.trim(), fsSource.trim());
  }

  use() {
    this.gl.useProgram(this.program);
  }

  getAttribLocation(name: string): number {
    return this.gl.getAttribLocation(this.program, name);
  }

  getUniformLocation(name: string): WebGLUniformLocation | null {
    return this.gl.getUniformLocation(this.program, name);
  }

  private getFullscreenStuff() {
    const { gl } = this;

    if (!this.fullscreenStuff) {
      // fullscreen quad geometry
      const quadBuffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
        gl.STATIC_DRAW,
      );
      const indexBuffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint16Array([0, 1, 2, 2, 3, 0]),
        gl.STATIC_DRAW,
      );
      this.fullscreenStuff = { quadBuffer, indexBuffer };
    }

    return this.fullscreenStuff;
  }

  run(props: {
    targetFramebuffer?: WebGLFramebuffer | null;
    viewport?: [number, number, number, number];
    uniforms?: Record<string, [UniformType, any]>;
    attributes?: Record<string, WebGLBuffer>;
    index?: {
      buffer: WebGLBuffer;
      count: number;
    };
    fullscreen?: boolean;
  }) {
    // fun new rule: eliminate state as much as we can

    const { gl } = this;
    let {
      targetFramebuffer = null,
      viewport = [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight],
      uniforms = {},
      attributes = {},
      index,
    } = props;

    if (props.fullscreen) {
      const { quadBuffer, indexBuffer } = this.getFullscreenStuff();
      attributes.position = quadBuffer;
      index = {
        buffer: indexBuffer,
        count: 6,
      };
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
    gl.viewport(...viewport);

    this.use();

    for (const [name, buffer] of Object.entries(attributes)) {
      const loc = this.getAttribLocation(name);
      if (loc === -1) {
        throw new Error(`Attribute ${name} not found in program`);
      }
      gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(loc);
      // todo: hardcoded
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }

    let textureIdx = 0;
    for (const [name, [type, value]] of Object.entries(uniforms)) {
      const loc = this.getUniformLocation(name);
      if (loc) {
        setUniform(gl, loc, type, value, textureIdx, (idx) => {
          textureIdx = idx;
        });
      } else {
        // we safely ignore uniforms that are not found
      }
    }

    if (index) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index.buffer);
      gl.drawElements(gl.TRIANGLES, index.count, gl.UNSIGNED_SHORT, 0);
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // unbind buffers
    for (const name of Object.keys(attributes)) {
      const loc = this.getAttribLocation(name);
      gl.disableVertexAttribArray(loc);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // unbind textures
    for (let i = 0; i < textureIdx; i++) {
      gl.activeTexture(getTextureUnit(gl, i));
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    gl.useProgram(null);
  }
}

export interface Tex {
  texture: WebGLTexture;
  width: number;
  height: number;
}

export function isProbablyTex(tex: any): tex is Tex {
  return (
    tex &&
    typeof tex === "object" &&
    "texture" in tex &&
    "width" in tex &&
    "height" in tex &&
    tex.texture instanceof WebGLTexture
  );
}

export function newTex(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): Tex {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  // gl.texImage2D(
  //   gl.TEXTURE_2D,
  //   0,
  //   gl.RGBA32F,
  //   width,
  //   height,
  //   0,
  //   gl.RGBA,
  //   gl.FLOAT,
  //   null,
  // );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { texture, width, height };
}

export function destroyTex(gl: WebGL2RenderingContext, tex: Tex): void {
  gl.deleteTexture(tex.texture);
}

export interface Fbo {
  tex: Tex;
  framebuffer: WebGLFramebuffer;
  gl: WebGL2RenderingContext;
}

export function newFbo(gl: WebGL2RenderingContext): Fbo {
  // HACK
  const tex = newTex(gl, 1280, 720);

  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    tex.texture,
    0,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { tex, framebuffer: fb, gl };
}

export function ensureFboSize(fbo: Fbo, width: number, height: number) {
  if (fbo.tex.width === width && fbo.tex.height === height) return;
  console.log(
    "resizing FBO from",
    fbo.tex.width,
    fbo.tex.height,
    "to",
    width,
    height,
  );
  fbo.tex.width = width;
  fbo.tex.height = height;
  const { gl, tex } = fbo;
  gl.bindTexture(gl.TEXTURE_2D, tex.texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
}

export function deleteFbo(fbo: Fbo) {
  const { gl, tex, framebuffer } = fbo;
  destroyTex(gl, tex);
  gl.deleteFramebuffer(framebuffer);
}

export interface Tex3D {
  texture: WebGLTexture;
  width: number;
  height: number;
  depth: number;
}

export function newTex3D(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  depth: number,
): Tex3D {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_3D, texture);
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RGBA,
    width,
    height,
    depth,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_3D, null);
  return { texture, width, height, depth };
}

export function destroyTex3D(gl: WebGL2RenderingContext, tex: Tex3D): void {
  gl.deleteTexture(tex.texture);
}
