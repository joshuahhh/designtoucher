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

export const CHECKER_PIXELS = 50;
export const CHECKER_DARK = 0.8;
export const CHECKER_LIGHT = 1.0;

export interface DrawArgs {
  tex: Tex;
  viewport?: [number, number, number, number];
  targetFramebuffer?: WebGLFramebuffer;
}

// viewport: drawn rect in device pixels; layoutSize: the guest div's
// unzoomed layout size in CSS px (offsetWidth/offsetHeight)
export type GuestCommand = (
  viewport: [number, number, number, number],
  layoutSize: [number, number],
) => void;

export type OmniCanvasContextType = {
  gl: WebGL2RenderingContext;
  setGuestCommand(
    div: HTMLDivElement,
    command: null | GuestCommand,
    priority?: number,
  ): void;
  draw(args: DrawArgs): void;
  drawForMonitor(
    args: DrawArgs & {
      cornerRadiusPixels?: number;
      checkerboardPixels?: number;
      uvScale?: [number, number];
      // Monitor surface size in unzoomed canvas px; the unit cornerRadiusPixels
      // is measured in. Defaults to the texture's dimensions.
      surfaceSize?: [number, number];
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

  // Map each guest <div> to its draw callback + priority. All guests share one
  // canvas with depth testing off, so paint order == stacking order. Guests are
  // drawn low-priority first, so higher priority ends up on top; ties keep Map
  // insertion order (React mount timing).
  const guestCommandsRef = useRef(
    new Map<
      HTMLDivElement,
      {
        command: GuestCommand;
        priority: number;
      }
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
        // Corner radius in unzoomed canvas px — same unit as CSS
        // border-radius, independent of the texture's resolution.
        uniform float cornerRadiusPixels;
        // Monitor surface size in unzoomed canvas px.
        uniform vec2 surfaceSize;
        uniform float checkerboardPixels;
        // Crop applied to the sampled image so it "covers" the monitor without
        // distortion. [1,1] = no crop (the image is stretched to fill, i.e.
        // "contain" when the monitor matches the texture aspect).
        uniform vec2 uvScale;
        varying vec2 uv;
        void main() {
          float cornerAlpha = 1.0;
          if (cornerRadiusPixels > 0.0) {
            vec2 uvFromCorner = 0.5 - abs(uv - 0.5);
            vec2 pixelsFromCorner = uvFromCorner * surfaceSize;
            vec2 pixelsFromCenter = vec2(cornerRadiusPixels) - pixelsFromCorner;
            if (pixelsFromCenter.x > 0.0 && pixelsFromCenter.y > 0.0) {
              float dist = length(pixelsFromCenter);
              if (dist > cornerRadiusPixels) {
                cornerAlpha = 0.0;
              }
            }
          }
          vec2 imgUv = (uv - 0.5) * uvScale + 0.5;
          vec4 img = texture2D(tex1, imgUv);
          if (checkerboardPixels > 0.0) {
            vec3 checkerboard = vec3(
              mod(floor(uv.x * resolution.x / checkerboardPixels) +
                  floor((1.0 - uv.y) * resolution.y / checkerboardPixels),
                2.0) * ${CHECKER_LIGHT - CHECKER_DARK} + ${CHECKER_DARK}
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
      uvScale,
      surfaceSize,
    }: DrawArgs & {
      cornerRadiusPixels?: number;
      checkerboardPixels?: number;
      uvScale?: [number, number];
      surfaceSize?: [number, number];
    }) => {
      drawForMonitorProgram.run({
        targetFramebuffer: targetFramebuffer || null,
        viewport,
        uniforms: {
          tex1: ["sampler2D", tex.texture],
          resolution: ["2f", [tex.width, tex.height]],
          cornerRadiusPixels: ["1f", cornerRadiusPixels],
          surfaceSize: ["2f", surfaceSize ?? [tex.width, tex.height]],
          checkerboardPixels: ["1f", checkerboardPixels],
          uvScale: ["2f", uvScale ?? [1, 1]],
        },
        fullscreen: true,
      });
    };

    const setGuestCommand = (
      div: HTMLDivElement,
      command: null | GuestCommand,
      priority = 0,
    ) => {
      if (command) {
        guestCommandsRef.current.set(div, { command, priority });
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

      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const { left: canvasLeft, top: canvasTop } =
        canvas.getBoundingClientRect();

      // Draw low priority first so higher-priority guests (e.g. the split-screen
      // preview) end up on top. A stable sort keeps Map insertion order within a
      // priority tier.
      const guests = [...guestCommandsRef.current.entries()].sort(
        (a, b) => a[1].priority - b[1].priority,
      );

      guests.forEach(([div, { command }]) => {
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

        command(
          [left, bottom, width, height],
          [div.offsetWidth, div.offsetHeight],
        );
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
  priority,
  ...props
}: {
  command: GuestCommand;
  priority?: number;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { setGuestCommand } = useContext(OmniCanvasContext);
  const [div, setDiv] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!div) return;
    setGuestCommand(div, command, priority);
    return () => setGuestCommand(div, null);
  }, [div, command, priority, setGuestCommand]);

  return <div ref={setDiv} {...props} />;
}

export function Monitor({
  tex,
  className,
  style,
  cornerRadiusPixels,
  checkerboardPixels,
  sizing = "fill",
  objectFit = "contain",
  priority,
}: {
  tex: Tex;
  className?: string;
  style?: React.CSSProperties;
  // Corner rounding radius in unzoomed canvas px — same unit as CSS
  // border-radius on the surrounding node (scales with canvas zoom,
  // independent of the texture's resolution)
  cornerRadiusPixels?: number;
  checkerboardPixels?: number;
  sizing?: "fill" | "height";
  // Stacking order among all guests on the shared canvas; higher draws on top.
  // Defaults to 0 (node-preview thumbnails). The split-screen preview raises
  // this so it always paints above overlapping node previews.
  priority?: number;
  // "contain": the guest div is given the texture's aspect ratio and the
  //   image fills it exactly (the surrounding layout letterboxes).
  // "cover": the guest div fills its container (any shape) and the image is
  //   cropped to cover it without distortion (computed per-frame from the
  //   drawn rect's aspect vs the texture's).
  objectFit?: "contain" | "cover";
}) {
  const { draw, drawForMonitor } = useContext(OmniCanvasContext);

  const command = useCallback(
    (
      viewport: [number, number, number, number],
      layoutSize: [number, number],
    ) => {
      let uvScale: [number, number] = [1, 1];
      if (objectFit === "cover") {
        const [, , w, h] = viewport;
        const containerAspect = w / h;
        const texAspect = tex.width / tex.height;
        uvScale =
          containerAspect >= texAspect
            ? [1, texAspect / containerAspect]
            : [containerAspect / texAspect, 1];
      }

      if (cornerRadiusPixels || checkerboardPixels || objectFit === "cover") {
        drawForMonitor({
          tex,
          viewport,
          cornerRadiusPixels: cornerRadiusPixels ?? 0,
          surfaceSize: layoutSize,
          checkerboardPixels: checkerboardPixels ?? CHECKER_PIXELS,
          uvScale,
        });
      } else {
        draw({ tex, viewport });
      }
    },
    [
      cornerRadiusPixels,
      checkerboardPixels,
      objectFit,
      draw,
      drawForMonitor,
      tex,
    ],
  );

  return (
    <OmniCanvasGuest
      command={command}
      priority={priority}
      className={clsx(
        className,
        objectFit === "cover"
          ? "w-full h-full"
          : sizing === "fill"
            ? "w-full h-full"
            : "h-full",
      )}
      style={{
        ...style,
        // In "cover" mode the div takes its container's shape; in "contain"
        // mode it is constrained to the texture's aspect ratio.
        aspectRatio: objectFit === "cover" ? undefined : tex.width / tex.height,
      }}
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
      const containerRect = overlayDiv.getBoundingClientRect();
      const r = anchor.getBoundingClientRect();
      // Derive zoom from the ratio of visual size (getBoundingClientRect,
      // includes CSS transforms like React Flow's viewport) to layout size
      // (offsetWidth, excludes transforms). This lets overlay content scale
      // with the canvas zoom without needing to import React Flow APIs.
      const zoom = anchor.offsetWidth > 0 ? r.width / anchor.offsetWidth : 1;
      wrapper.style.transformOrigin = "0 0";
      wrapper.style.transform = `translate(${r.left - containerRect.left}px, ${r.top - containerRect.top}px) scale(${zoom})`;
      wrapper.style.width = `${anchor.offsetWidth}px`;
      wrapper.style.height = `${anchor.offsetHeight}px`;
    };

    update();
    return autoUpdate(anchor, wrapper, update, { animationFrame: true });
  }, [overlayDiv]);

  return (
    <>
      <div ref={anchorRef} {...rest} />
      {overlayDiv &&
        createPortal(
          <Theme ref={wrapperRef} className="pointer-events-none">
            {children}
          </Theme>,
          overlayDiv,
        )}
    </>
  );
});
