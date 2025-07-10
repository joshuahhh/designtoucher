import { up } from "@engraft/update-proxy";
import _ from "lodash";
import { useEffect, useMemo, useState } from "react";
import reglConstructor, { Regl } from "regl";
import { animate } from "./util.js";

const boxes = _.range(300).map((i) => ({
  width: 640 * Math.random(),
  height: 480 * Math.random(),
  h: Math.random(),
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
        uniform float h;

        float hue2rgb(float f1, float f2, float hue) {
            if (hue < 0.0)
                hue += 1.0;
            else if (hue > 1.0)
                hue -= 1.0;
            float res;
            if ((6.0 * hue) < 1.0)
                res = f1 + (f2 - f1) * 6.0 * hue;
            else if ((2.0 * hue) < 1.0)
                res = f2;
            else if ((3.0 * hue) < 2.0)
                res = f1 + (f2 - f1) * ((2.0 / 3.0) - hue) * 6.0;
            else
                res = f1;
            return res;
        }

        vec3 hsl2rgb(vec3 hsl) {
            vec3 rgb;

            if (hsl.y == 0.0) {
                rgb = vec3(hsl.z); // Luminance
            } else {
                float f2;

                if (hsl.z < 0.5)
                    f2 = hsl.z * (1.0 + hsl.y);
                else
                    f2 = hsl.z + hsl.y - hsl.y * hsl.z;

                float f1 = 2.0 * hsl.z - f2;

                rgb.r = hue2rgb(f1, f2, hsl.x + (1.0/3.0));
                rgb.g = hue2rgb(f1, f2, hsl.x);
                rgb.b = hue2rgb(f1, f2, hsl.x - (1.0/3.0));
            }
            return rgb;
        }

        vec3 hsl2rgb(float h, float s, float l) {
            return hsl2rgb(vec3(h, s, l));
        }

        void main () {
          gl_FragColor = vec4(hsl2rgb(h, 1.0, 0.5), 1);
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
        h: regl.prop<any, "h">("h"),
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
            return; // it's off screen
          }

          gl.scissor(rect.left, bottom, rect.width, rect.height);
          gl.viewport(rect.left, bottom, rect.width, rect.height);
          command({
            h: div.dataset.h
              ? (parseFloat(div.dataset.h) + +new Date() / 1000) % 1
              : 0,
          });
        }
      });
    });
  });

  return (
    <div className="min-w-full min-h-full p-10 prose box-border">
      <canvas
        ref={setFullScreenCanvas}
        className="absolute left-0 top-0 w-full h-full pointer-events-none"
        // className="fixed left-0 top-0 w-full h-full pointer-events-none"
      />
      <div>
        {boxes.map((box, i) => (
          <>
            <div
              key={i}
              ref={divsUP[i].$set}
              className="border border-black inline-block"
              style={box}
              data-h={box.h}
            />
          </>
        ))}
      </div>
    </div>
  );
};
