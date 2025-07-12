import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import reglConstructor, {
  DefaultContext,
  DrawCommand,
  Framebuffer2D,
  Regl,
  Texture2D,
} from "regl";

export type OmniCanvasContext = {
  regl: Regl;
  setDrawCommand: (div: HTMLDivElement, command: null | (() => void)) => void;
  draw: DrawCommand<DefaultContext, { tex1: Texture2D }>;
  copy: DrawCommand<
    DefaultContext,
    { tex1: Texture2D; framebuffer: Framebuffer2D }
  >;
};
export const OmniCanvasContext = createContext<OmniCanvasContext>(null as any);

export function OmniCanvasHost({ children }: { children: React.ReactNode }) {
  const [fullScreenCanvas, setFullScreenCanvas] =
    useState<HTMLCanvasElement | null>(null);

  const [regl, setRegl] = useState<Regl | null>(null);

  useEffect(() => {
    if (!fullScreenCanvas) return;

    setRegl((regl: Regl | null) => {
      if (regl) regl.destroy();

      return reglConstructor({
        canvas: fullScreenCanvas,
        pixelRatio: 2,
        attributes: {
          stencil: false,
          antialias: true,
          depth: false,
        },
      });
    });
  }, [fullScreenCanvas]);

  const drawCommandsRef = useRef<Map<HTMLDivElement, () => void>>(new Map());

  useEffect(() => {
    if (!regl || !fullScreenCanvas) return;

    const frame = regl.frame(() => {
      fullScreenCanvas.width = fullScreenCanvas.clientWidth;
      fullScreenCanvas.height = fullScreenCanvas.clientHeight;
      fullScreenCanvas.style.transform = `translateY(${window.scrollY}px)`;

      drawCommandsRef.current.forEach((command, div) => {
        const rect = div.getBoundingClientRect();
        const bottom = fullScreenCanvas.offsetHeight - rect.bottom;

        // console.log("drawing command for div", div, rect);

        // check if it's offscreen. If so skip it
        if (
          rect.bottom < 0 ||
          rect.top > fullScreenCanvas.clientHeight ||
          rect.right < 0 ||
          rect.left > fullScreenCanvas.clientWidth
        ) {
          return; // it's off screen
        }

        regl({
          viewport: {
            x: rect.left,
            y: bottom,
            width: rect.width,
            height: rect.height,
          },
          scissor: {
            enable: true,
            box: {
              x: rect.left,
              y: bottom,
              width: rect.width,
              height: rect.height,
            },
          },
        })(() => {
          command();
        });
      });
    });
    return () => {
      frame.cancel();
    };
  }, [fullScreenCanvas, regl]);

  const contextValue: OmniCanvasContext | null = useMemo(() => {
    if (!regl) return null;
    return {
      regl: regl,
      setDrawCommand(div: HTMLDivElement, command: null | (() => void)) {
        if (command) {
          drawCommandsRef.current.set(div, command);
        } else {
          drawCommandsRef.current.delete(div);
        }
      },
      draw: regl({
        frag: `
          precision mediump float;
          uniform sampler2D tex1;
          varying vec2 uv;
          void main () {
            gl_FragColor = texture2D(tex1, uv);
          }
        `,
        vert: `
          precision mediump float;
          attribute vec2 position;
          varying vec2 uv;
          void main () {
            uv = 0.5 * (position + 1.0);
            gl_Position = vec4(position, 0, 1);
          }
        `,
        attributes: {
          position: [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ],
        },
        elements: [
          [0, 1, 2],
          [2, 3, 0],
        ],
        uniforms: {
          tex1: regl.prop<any, any>("tex1"),
        },
      }),
      copy: regl({
        frag: `
          precision mediump float;
          uniform sampler2D tex1;
          varying vec2 uv;
          void main () {
            gl_FragColor = texture2D(tex1, uv);
          }
        `,
        vert: `
          precision mediump float;
          attribute vec2 position;
          varying vec2 uv;
          void main () {
            uv = 0.5 * (position + 1.0);
            gl_Position = vec4(position, 0, 1);
          }
        `,
        attributes: {
          position: [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ],
        },
        elements: [
          [0, 1, 2],
          [2, 3, 0],
        ],
        uniforms: {
          tex1: regl.prop<any, any>("tex1"),
        },
        framebuffer: regl.prop<any, any>("framebuffer"),
      }),
    };
  }, [regl]);

  return (
    <>
      <canvas
        ref={setFullScreenCanvas}
        className="absolute left-0 top-0 w-full h-full pointer-events-none"
        // className="fixed left-0 top-0 w-full h-full pointer-events-none"
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
}: { command: () => void } & React.HTMLAttributes<HTMLDivElement>) {
  const { setDrawCommand } = useContext(OmniCanvasContext);
  const [div, setDiv] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!div) return;

    setDrawCommand(div, command);

    return () => {
      setDrawCommand(div, null);
    };
  }, [div, command, setDrawCommand]);

  return <div ref={setDiv} {...props} />;
}
