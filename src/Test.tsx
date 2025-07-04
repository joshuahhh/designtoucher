import { up } from "@engraft/update-proxy";
import _ from "lodash";
import { useEffect, useMemo, useState } from "react";
import reglConstructor, { Regl } from "regl";
import { animate } from "./util.js";

const boxes = _.range(300).map((i) => ({
  width: 640 * Math.random(),
  height: 480 * Math.random(),
}));

export const Test = () => {
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

  const command = useMemo(() => {
    return regl?.({
      frag: `
        precision mediump float;
        uniform vec4 color;
        void main () {
          gl_FragColor = color;
        }
      `,

      vert: `
        precision mediump float;
        attribute vec2 position;
        void main () {
          gl_Position = vec4(position, 0, 1);
        }
      `,

      attributes: {
        position: [
          [-1, 0],
          [0, -1],
          [1, 1],
        ],
      },

      uniforms: {
        color: [1, 0, 0, 1],
      },

      count: 3,
    });
  }, [regl]);

  const [divs, setDivs] = useState<(HTMLDivElement | null)[]>(
    boxes.map(() => null),
  );
  const divsUP = up(setDivs);

  useEffect(() => {
    return animate(() => {
      if (!regl || !command || !fullScreenCanvas) return;

      fullScreenCanvas.width = fullScreenCanvas.clientWidth;
      fullScreenCanvas.height = fullScreenCanvas.clientHeight;
      fullScreenCanvas.style.transform = `translateY(${window.scrollY}px)`;

      const gl = regl._gl;

      divs.forEach((div, i) => {
        if (div) {
          const rect = div.getBoundingClientRect();
          const bottom = fullScreenCanvas.offsetHeight - rect.bottom;

          // check if it's offscreen. If so skip it
          if (
            rect.bottom < 0 ||
            rect.top > fullScreenCanvas.clientHeight ||
            rect.right < 0 ||
            rect.left > fullScreenCanvas.clientWidth
          ) {
            console.log("Skipping offscreen div", i, rect);
            return; // it's off screen
          }

          gl.scissor(rect.left, bottom, rect.width, rect.height);
          gl.viewport(rect.left, bottom, rect.width, rect.height);
          command({
            uniforms: {
              color: [Math.random(), Math.random(), Math.random(), 1],
            },
          });
        }
      });
    });
  });

  return (
    <div className="w-full h-full p-10 prose box-border">
      <canvas
        ref={setFullScreenCanvas}
        className="absolute left-0 top-0 w-full h-full pointer-events-none"
        // className="fixed left-0 top-0 w-full h-full pointer-events-none"
      />
      {boxes.map((box, i) => (
        <div key={i}>
          <h1>hi</h1>
          <div
            ref={divsUP[i].$set}
            className="border border-black"
            style={box}
          />
        </div>
      ))}
    </div>
  );
};
