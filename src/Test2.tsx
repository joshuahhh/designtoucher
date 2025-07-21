import _ from "lodash";
import { useContext, useMemo } from "react";
import {
  OmniCanvasContext,
  OmniCanvasGuest,
  OmniCanvasHost,
} from "./OmniCanvas.js";
import { ShaderProgram } from "./mygl.js";

// ---------------------------------------------------------------------
// Demo boxes whose colour cycles over time
// ---------------------------------------------------------------------
const boxes = _.range(300).map(() => ({
  width: 640 * Math.random(),
  height: 480 * Math.random(),
  h: Math.random(), // initial hue [0‒1)
}));

export const Test2 = () => (
  <div className="min-w-full min-h-full p-10 prose box-border">
    <OmniCanvasHost>
      <Test2Inner />
    </OmniCanvasHost>
  </div>
);

export const Test2Inner = () => {
  const { gl } = useContext(OmniCanvasContext);

  // -------------------------------------------------------------------
  // Compile program + buffers exactly once (when `gl` becomes available)
  // -------------------------------------------------------------------
  const drawTriangle = useMemo(() => {
    if (!gl) return null;

    const program = new ShaderProgram(
      gl,
      `
        precision mediump float;
        attribute vec2 position;
        void main() { gl_Position = vec4(position, 0.0, 1.0); }
      `,
      `
        precision mediump float;
        uniform float h;

        // ===== tiny HSL‑>RGB helper =====
        float hue2rgb(float f1,float f2,float hue){
          hue = mod(hue,1.0);
          if (6.0*hue < 1.0) return f1 + (f2-f1)*6.0*hue;
          if (2.0*hue < 1.0) return f2;
          if (3.0*hue < 2.0) return f1 + (f2-f1)*(2.0/3.0 - hue)*6.0;
          return f1;
        }
        vec3 hsl2rgb(float hh,float s,float l){
          if (s==0.0) return vec3(l);
          float f2 = l < 0.5 ? l*(1.0+s) : l+s-l*s;
          float f1 = 2.0*l - f2;
          return vec3(
            hue2rgb(f1,f2,hh+1.0/3.0),
            hue2rgb(f1,f2,hh),
            hue2rgb(f1,f2,hh-1.0/3.0)
          );
        }

        void main() {
          gl_FragColor = vec4(hsl2rgb(h,1.0,0.5), 1.0);
        }
      `,
    );

    // Triangle geometry (clip‑space coords)
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1.1, 0, 0, -1.1, 1.1, 1.1]),
      gl.STATIC_DRAW,
    );

    // Returned function: draw the triangle with a given hue
    return (h: number, viewport: [number, number, number, number]) => {
      program.run({
        targetFramebuffer: null,
        viewport,
        uniforms: { h: ["1f", h] },
        attributes: {
          position: posBuf,
        },
      });
    };
  }, [gl]);

  // Until WebGL is ready, render nothing
  if (!drawTriangle) return null;

  return (
    <>
      {boxes.map((box, i) => (
        <OmniCanvasGuest
          key={i}
          className="border border-black inline-block"
          style={box}
          command={(viewport) =>
            drawTriangle(((box.h + Date.now() / 1000) % 1) as number, viewport)
          }
        />
      ))}
    </>
  );
};
