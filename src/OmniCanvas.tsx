import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import reglConstructor, { Regl } from "regl";
import { animate } from "./util.js";

export type OmniCanvasContext = {
  regl: Regl;
  setDrawCommand: (div: HTMLDivElement, command: null | (() => void)) => void;
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
      });
    });
  }, [fullScreenCanvas]);

  const drawCommandsRef = useRef<Map<HTMLDivElement, () => void>>(new Map());

  useEffect(() => {
    return animate(() => {
      if (!regl || !fullScreenCanvas) return;

      fullScreenCanvas.width = fullScreenCanvas.clientWidth;
      fullScreenCanvas.height = fullScreenCanvas.clientHeight;
      fullScreenCanvas.style.transform = `translateY(${window.scrollY}px)`;

      const gl = regl._gl;

      drawCommandsRef.current.forEach((command, div) => {
        const rect = div.getBoundingClientRect();
        const bottom = fullScreenCanvas.offsetHeight - rect.bottom;

        // check if it's offscreen. If so skip it
        if (
          rect.bottom < 0 ||
          rect.top > fullScreenCanvas.clientHeight ||
          rect.right < 0 ||
          rect.left > fullScreenCanvas.clientWidth
        ) {
          return; // it's off screen
        }

        gl.scissor(rect.left, bottom, rect.width, rect.height);
        gl.viewport(rect.left, bottom, rect.width, rect.height);
        command();
      });
    });
  });

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
