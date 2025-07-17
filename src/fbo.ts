/* ------------------------------------------------------------------
 * Minimal framebuffer‑object helper (WebGL1, no regl)
 * ---------------------------------------------------------------- */
export interface Fbo {
  /** backing texture */
  tex: WebGLTexture;
  /** framebuffer handle */
  fb: WebGLFramebuffer;
  /** current size in pixels */
  width: number;
  height: number;
  /** ensure texture/framebuffer size == (w,h) */
  resize(w: number, h: number): void;
  /** delete GL resources */
  destroy(): void;
}

/**
 * Allocate an off‑screen RGBA8 framebuffer with linear filtering.
 * The initial size is 1×1; call `resize()` before first use.
 */
export function Fbo(gl: WebGLRenderingContext): Fbo {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
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
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  let width = 1;
  let height = 1;

  const resize = (w: number, h: number) => {
    if (w === width && h === height) return;
    width = w;
    height = h;
    gl.bindTexture(gl.TEXTURE_2D, tex);
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
  };

  const destroy = () => {
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
  };

  return { tex, fb, width, height, resize, destroy };
}
