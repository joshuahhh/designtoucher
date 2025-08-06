import { clsx } from "clsx";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { newTex, ShaderProgram, Tex } from "./mygl.js";

export interface DrawArgs {
  texture: WebGLTexture;
  viewport?: [number, number, number, number];
  targetFramebuffer?: WebGLFramebuffer;
}

export type OmniCanvasContextType = {
  gl: WebGL2RenderingContext;
  setGuestCommand(
    div: HTMLDivElement,
    command: null | ((viewport: [number, number, number, number]) => void),
  ): void;
  draw(args: DrawArgs): void;
  emptyTex: Tex;
};

export const OmniCanvasContext = createContext<OmniCanvasContextType>(
  null as any,
);

export function OmniCanvasHost({ children }: { children: React.ReactNode }) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [gl, setGl] = useState<WebGL2RenderingContext | null>(null);

  // Map each guest <div> to its draw callback
  const guestCommandsRef = useRef(
    new Map<
      HTMLDivElement,
      (viewport: [number, number, number, number]) => void
    >(),
  );

  useEffect(() => {
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      antialias: true,
      depth: false,
      stencil: false,
      alpha: true,
      premultipliedAlpha: true,
    });

    if (!gl) throw new Error("WebGL 2 not supported");

    gl.getExtension("OES_texture_float");
    gl.getExtension("OES_texture_float_linear");

    setGl(gl);
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

    const emptyTex = newTex(gl, 1280, 720);

    return { gl, setGuestCommand, draw, emptyTex };
  }, [gl]);

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

        const left = Math.floor(rectCSS.left * dpr);
        const bottom = Math.floor(bottomCSS * dpr);
        const width = Math.ceil(rectCSS.width * dpr) + 1;
        const height = Math.ceil(rectCSS.height * dpr) + 1;

        command([left, bottom, width, height]);
      });

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
    return () => {
      cancelled = true;
    };
  }, [gl, canvas]);

  return (
    <>
      <canvas
        ref={setCanvas}
        // TODO: don't love the z-index here
        className="absolute left-0 top-0 w-full h-full pointer-events-none z-[1]"
      />
      {contextValue && (
        <OmniCanvasContext.Provider value={contextValue}>
          {children}
        </OmniCanvasContext.Provider>
      )}
    </>
  );
}

export function OmniCanvasGuest({
  command,
  ...props
}: {
  command: (viewport: [number, number, number, number]) => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { setGuestCommand } = useContext(OmniCanvasContext);
  const [div, setDiv] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!div) return;
    setGuestCommand(div, command);
    return () => setGuestCommand(div, null);
  }, [div, command, setGuestCommand]);

  return <div ref={setDiv} {...props} />;
}

export function Monitor({ tex, className }: { tex: Tex; className?: string }) {
  const { draw } = useContext(OmniCanvasContext);

  const command = useCallback(
    (viewport: [number, number, number, number]) => {
      draw({ texture: tex.texture, viewport });
    },
    [draw, tex.texture],
  );

  return (
    <OmniCanvasGuest
      command={command}
      className={clsx(className, "w-full h-full")}
      style={{
        aspectRatio: tex.width / tex.height,
        background:
          "repeating-conic-gradient(#808080 0 25%, #FFF 0 50%) 50% / 20px 20px",
      }}
    />
  );
}
