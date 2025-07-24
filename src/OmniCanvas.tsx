import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ShaderProgram } from "./mygl.js";

console.log("hi");

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
  viewport?: [number, number, number, number];
  targetFramebuffer?: WebGLFramebuffer;
}

export type OmniCanvasContextType = {
  gl: WebGLRenderingContext;
  setGuestCommand(
    div: HTMLDivElement,
    command: null | ((viewport: [number, number, number, number]) => void),
  ): void;
  draw(args: DrawArgs): void;
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
  const guestCommandsRef = useRef(
    new Map<
      HTMLDivElement,
      (viewport: [number, number, number, number]) => void
    >(),
  );

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

  const contextValue: OmniCanvasContextType | null = useMemo(() => {
    if (!gl) return null;

    const program = new ShaderProgram(
      gl,
      `
        attribute vec2 position;
        varying vec2 uv;
        void main() {
          uv = 0.5 * (position + 1.0);
          gl_Position = vec4(position, 0.0, 1.0);
        }
      `,
      `
        precision mediump float;
        uniform sampler2D tex1;
        varying vec2 uv;
        void main() {
          // gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0) + (0.0 * texture2D(tex1, uv));
          gl_FragColor = texture2D(tex1, uv);
        }
      `,
    );

    const draw = ({ texture, viewport, targetFramebuffer }: DrawArgs) => {
      program.run({
        targetFramebuffer: targetFramebuffer || null,
        viewport,
        uniforms: { tex1: ["sampler2D", texture] },
        fullscreen: true,
      });
    };

    const setGuestCommand = (
      div: HTMLDivElement,
      command: null | ((viewport: [number, number, number, number]) => void),
    ) => {
      if (command) {
        guestCommandsRef.current.set(div, command);
      } else {
        guestCommandsRef.current.delete(div);
      }
    };

    return { gl, setGuestCommand, draw };
  }, [gl]);

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

      guestCommandsRef.current.forEach((command, div) => {
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

        command([left, bottom, width, height]);
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
  command: (viewport: [number, number, number, number]) => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { setGuestCommand } = useContext(OmniCanvasContext);
  const [div, setDiv] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!div) return;
    setGuestCommand(div, command);
    return () => setGuestCommand(div, null);
  }, [div, command, setGuestCommand]);

  return <div ref={setDiv} {...props} />;
}
