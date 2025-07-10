import _ from "lodash";
import { useContext, useMemo } from "react";
import {
  OmniCanvasContext,
  OmniCanvasGuest,
  OmniCanvasHost,
} from "./OmniCanvas.js";

const boxes = _.range(300).map((i) => ({
  width: 640 * Math.random(),
  height: 480 * Math.random(),
  h: Math.random(),
}));

export const Test2 = () => {
  return (
    <div className="min-w-full min-h-full p-10 prose box-border">
      <OmniCanvasHost>
        <Test2Inner />
      </OmniCanvasHost>
    </div>
  );
};

export const Test2Inner = () => {
  const { regl } = useContext(OmniCanvasContext);

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

  return (
    <>
      {boxes.map((box, i) => (
        <OmniCanvasGuest
          key={i}
          command={() => {
            command({
              h: box.h ? (box.h + +new Date() / 1000) % 1 : 0,
            });
          }}
          className="border border-black inline-block"
          style={box}
        />
      ))}
    </>
  );
};
