import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* ------------------------------------------------------------------
 * Tiny WebGL helper utilities (no external deps)
 * ---------------------------------------------------------------- */
function createShader(gl: WebGLRenderingContext, src: string, type: number) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Shader compile error");
  }
  return shader;
}

export function createProgram(
  gl: WebGLRenderingContext,
  vert: string,
  frag: string,
) {
  const program = gl.createProgram()!;
  gl.attachShader(program, createShader(gl, vert, gl.VERTEX_SHADER));
  gl.attachShader(program, createShader(gl, frag, gl.FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Program link error");
  }
  return program;
}

/* ------------------------------------------------------------------
 * Public types
 * ---------------------------------------------------------------- */
export interface DrawArgs {
  texture: WebGLTexture;
}

export interface CopyArgs extends DrawArgs {
  framebuffer: WebGLFramebuffer;
}

export type OmniCanvasContextType = {
  gl: WebGLRenderingContext;
  setDrawCommand(div: HTMLDivElement, command: null | (() => void)): void;
  draw(args: DrawArgs): void;
  copy(args: CopyArgs): void;
};

export const OmniCanvasContext = createContext<OmniCanvasContextType>(
  null as any,
);

/* ------------------------------------------------------------------
 * OmniCanvasHost – provides the GL context & render loop
 * ---------------------------------------------------------------- */
export function OmniCanvasHost({ children }: { children: React.ReactNode }) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [gl, setGl] = useState<WebGLRenderingContext | null>(null);

  // Map each guest <div> to its draw callback
  const drawCommandsRef = useRef(new Map<HTMLDivElement, () => void>());

  /* ------------------------ initialize WebGL --------------------- */
  useEffect(() => {
    if (!canvas) return;

    const ctx = canvas.getContext("webgl", {
      antialias: true,
      depth: false,
      stencil: false,
      alpha: true,
      premultipliedAlpha: true,
    });

    if (!ctx) throw new Error("WebGL not supported");
    setGl(ctx);
  }, [canvas]);

  /* -------------------- programs, buffers, state ------------------ */
  const resources = useMemo(() => {
    if (!gl) return null;

    const vertSrc = `
      attribute vec2 position;
      varying vec2 uv;
      void main() {
        uv = 0.5 * (position + 1.0);
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    const fragSrc = `
      precision mediump float;
      uniform sampler2D tex1;
      varying vec2 uv;
      void main() {
        gl_FragColor = texture2D(tex1, uv);
      }
    `;

    const program = createProgram(gl, vertSrc, fragSrc);

    const positionLoc = gl.getAttribLocation(program, "position");
    const texLoc = gl.getUniformLocation(program, "tex1");

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

    const bindQuad = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    };

    return { program, texLoc, bindQuad } as const;
  }, [gl]);

  /* ------------------------ draw helpers ------------------------- */
  const contextValue: OmniCanvasContextType | null = useMemo(() => {
    if (!gl || !resources) return null;

    const clearState = () => {
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    const draw = ({ texture }: DrawArgs) => {
      gl.useProgram(resources.program);
      resources.bindQuad();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(resources.texLoc, 0);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      clearState();
    };

    const copy = ({ texture, framebuffer }: CopyArgs) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      draw({ texture });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    const setDrawCommand = (
      div: HTMLDivElement,
      command: null | (() => void),
    ) => {
      if (command) {
        drawCommandsRef.current.set(div, command);
      } else {
        drawCommandsRef.current.delete(div);
      }
    };

    return { gl, setDrawCommand, draw, copy };
  }, [gl, resources]);

  /* ------------------------ frame loop --------------------------- */
  useEffect(() => {
    if (!gl || !canvas) return;

    let cancelled = false;

    const render = () => {
      if (cancelled) return;

      const dpr = window.devicePixelRatio || 1;
      const wCSS = canvas.clientWidth;
      const hCSS = canvas.clientHeight;
      const w = wCSS * dpr;
      const h = hCSS * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      canvas.style.transform = `translateY(${window.scrollY}px)`;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      drawCommandsRef.current.forEach((command, div) => {
        const rectCSS = div.getBoundingClientRect();
        const bottomCSS = hCSS - rectCSS.bottom;

        if (
          rectCSS.bottom < 0 ||
          rectCSS.top > hCSS ||
          rectCSS.right < 0 ||
          rectCSS.left > wCSS
        )
          return;

        const left = rectCSS.left * dpr;
        const bottom = bottomCSS * dpr;
        const width = rectCSS.width * dpr;
        const height = rectCSS.height * dpr;

        gl.viewport(left, bottom, width, height);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(left, bottom, width, height);

        command();
      });

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
    return () => {
      cancelled = true;
    };
  }, [gl, canvas]);

  /* --------------------------- JSX ------------------------------- */
  return (
    <>
      <canvas
        ref={setCanvas}
        className="absolute left-0 top-0 w-full h-full pointer-events-none"
      />
      {contextValue && (
        <OmniCanvasContext.Provider value={contextValue}>
          {children}
        </OmniCanvasContext.Provider>
      )}
    </>
  );
}

/* ------------------------------------------------------------------
 * OmniCanvasGuest – registers draw callback for a DOM rect
 * ---------------------------------------------------------------- */
export function OmniCanvasGuest({
  command,
  ...props
}: {
  command: () => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { setDrawCommand } = useContext(OmniCanvasContext);
  const [div, setDiv] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!div) return;
    setDrawCommand(div, command);
    return () => setDrawCommand(div, null);
  }, [div, command, setDrawCommand]);

  return <div ref={setDiv} {...props} />;
}
