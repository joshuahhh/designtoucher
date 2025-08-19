import { autoUpdate } from "@floating-ui/dom";
import { Theme } from "@radix-ui/themes";
import { clsx } from "clsx";
import React, {
  createContext,
  forwardRef,
  HTMLAttributes,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { newTex, ShaderProgram, Tex } from "./mygl.js";

export interface DrawArgs {
  tex: Tex;
  viewport?: [number, number, number, number];
  targetFramebuffer?: WebGLFramebuffer;
  cornerRadiusPixels?: number;
}

export type OmniCanvasContextType = {
  gl: WebGL2RenderingContext;
  setGuestCommand(
    div: HTMLDivElement,
    command: null | ((viewport: [number, number, number, number]) => void),
  ): void;
  draw(args: DrawArgs): void;
  drawForMonitor(
    args: DrawArgs & {
      cornerRadiusPixels?: number;
      checkerboardPixels?: number;
    },
  ): void;
  emptyTex: Tex;
  underlayDiv: HTMLDivElement;
  overlayDiv: HTMLDivElement;
};

export const OmniCanvasContext = createContext<OmniCanvasContextType>(
  null as any,
);

export function OmniCanvasHost({ children }: { children: React.ReactNode }) {
  const [underlayDiv, setUnderlayDiv] = useState<HTMLDivElement | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [overlayDiv, setOverlayDiv] = useState<HTMLDivElement | null>(null);
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
    if (!gl || !underlayDiv || !overlayDiv) return null;

    const drawProgram = new ShaderProgram(
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
          gl_FragColor = texture2D(tex1, uv);
        }
      `,
    );

    const draw = ({ tex, viewport, targetFramebuffer }: DrawArgs) => {
      drawProgram.run({
        targetFramebuffer: targetFramebuffer || null,
        viewport,
        uniforms: { tex1: ["sampler2D", tex.texture] },
        fullscreen: true,
      });
    };

    const drawForMonitorProgram = new ShaderProgram(
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
        uniform vec2 resolution;
        uniform float cornerRadiusPixels;
        uniform float checkerboardPixels;
        varying vec2 uv;
        void main() {
          float cornerAlpha = 1.0;
          if (cornerRadiusPixels > 0.0) {
            vec2 uvFromCorner = 0.5 - abs(uv - 0.5);
            vec2 pixelsFromCorner = uvFromCorner * resolution;
            vec2 pixelsFromCenter = vec2(cornerRadiusPixels) - pixelsFromCorner;
            if (pixelsFromCenter.x > 0.0 && pixelsFromCenter.y > 0.0) {
              float dist = length(pixelsFromCenter);
              if (dist > cornerRadiusPixels) {
                cornerAlpha = 0.0;
              }
            }
          }
          vec4 img = texture2D(tex1, uv);
          if (checkerboardPixels > 0.0) {
            vec3 checkerboard = vec3(
              mod(floor(uv.x * resolution.x / checkerboardPixels) +
                  floor(uv.y * resolution.y / checkerboardPixels),
                2.0) * 0.5 + 0.5
            );
            gl_FragColor = vec4(img.rgb * img.a + checkerboard * (1.0 - img.a), 1.0);
          } else {
            gl_FragColor = img;
          }
          gl_FragColor.a = cornerAlpha;
        }
      `,
    );

    const drawForMonitor = ({
      tex,
      viewport,
      targetFramebuffer,
      cornerRadiusPixels,
      checkerboardPixels,
    }: DrawArgs & {
      cornerRadiusPixels?: number;
      checkerboardPixels?: number;
    }) => {
      drawForMonitorProgram.run({
        targetFramebuffer: targetFramebuffer || null,
        viewport,
        uniforms: {
          tex1: ["sampler2D", tex.texture],
          resolution: ["2f", [tex.width, tex.height]],
          cornerRadiusPixels: ["1f", cornerRadiusPixels],
          checkerboardPixels: ["1f", checkerboardPixels],
        },
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

    return {
      gl,
      setGuestCommand,
      draw,
      drawForMonitor,
      emptyTex,
      overlayDiv,
      underlayDiv,
    };
  }, [gl, overlayDiv, underlayDiv]);

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

      const { left: canvasLeft, top: canvasTop } =
        canvas.getBoundingClientRect();

      guestCommandsRef.current.forEach((command, div) => {
        const rectCSS = div.getBoundingClientRect();
        const bottomCSS = hCSS - (rectCSS.bottom - canvasTop);

        if (
          rectCSS.bottom < 0 ||
          rectCSS.top > hCSS ||
          rectCSS.right < 0 ||
          rectCSS.left > wCSS
        ) {
          return;
        }

        const left = (rectCSS.left - canvasLeft) * dpr;
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

  return (
    <>
      <div ref={setUnderlayDiv} className="absolute inset-0">
        {contextValue && (
          <OmniCanvasContext.Provider value={contextValue}>
            {children}
          </OmniCanvasContext.Provider>
        )}
      </div>
      <canvas
        ref={setCanvas}
        // TODO:
        // - don't love the z-index here
        // - canvas doesn't want to be inset-0 – it wants to be
        //   left-0 top-0 w-full h-full
        className="absolute left-0 top-0 w-full h-full pointer-events-none z-[1]"
      />
      <div
        ref={setOverlayDiv}
        className="absolute inset-0 z-[2] pointer-events-none"
      />
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

export function Monitor({
  tex,
  className,
  style,
  cornerRadiusPixels,
}: {
  tex: Tex;
  className?: string;
  style?: React.CSSProperties;
  cornerRadiusPixels?: number;
}) {
  const { draw, drawForMonitor } = useContext(OmniCanvasContext);

  const command = useCallback(
    (viewport: [number, number, number, number]) => {
      if (cornerRadiusPixels) {
        drawForMonitor({
          tex,
          viewport,
          cornerRadiusPixels,
          checkerboardPixels: 100,
        });
      } else {
        draw({ tex, viewport });
      }
    },
    [cornerRadiusPixels, draw, drawForMonitor, tex],
  );

  return (
    <OmniCanvasGuest
      command={command}
      className={clsx(className, "w-full h-full")}
      style={{ ...style, aspectRatio: tex.width / tex.height }}
    />
  );
}

export const OmniCanvasOverlay = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ children, ...rest }, ref) => {
  const { overlayDiv } = useContext(OmniCanvasContext);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Expose the anchor ref if parent passed one
  useLayoutEffect(() => {
    if (!ref) return;
    if (typeof ref === "function") ref(anchorRef.current!);
    else
      (ref as React.MutableRefObject<HTMLDivElement | null>).current =
        anchorRef.current;
  }, [ref]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const wrapper = wrapperRef.current;
    if (!anchor || !wrapper || !overlayDiv) return;

    wrapper.style.position = "absolute";
    wrapper.style.willChange = "transform,width,height";

    const update = () => {
      const r = anchor.getBoundingClientRect();
      wrapper.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(
        r.top,
      )}px)`;
      wrapper.style.width = `${Math.round(r.width)}px`;
      wrapper.style.height = `${Math.round(r.height)}px`;
    };

    update();
    return autoUpdate(anchor, wrapper, update);
  }, [overlayDiv]);

  return (
    <>
      <div ref={anchorRef} {...rest} />
      {overlayDiv &&
        createPortal(
          <Theme
            ref={wrapperRef}
            className="pointer-events-none [&>*]:pointer-events-auto"
          >
            {children}
          </Theme>,
          overlayDiv,
        )}
    </>
  );
});
