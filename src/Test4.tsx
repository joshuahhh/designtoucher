import { useEffect, useState } from "react";
import createREGL from "regl";

export const Test4 = () => {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvas) return;

    const regl = createREGL({ canvas });

    const drawTri = regl({
      frag: `
        precision mediump float;
        uniform vec4 color;
        void main() {
          gl_FragColor = color;
        }
      `,
      vert: `
        precision mediump float;
        attribute vec2 position;
        void main() {
          gl_Position = vec4(position, 0, 1);
        }
      `,

      uniforms: {
        color: regl.prop<any, any>("color"),
      },
      attributes: {
        position: [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ],
      },
      elements: [[0, 1, 2]],
    });

    const drawTex = regl({
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
    });

    const texture = regl.texture({ width: 400, height: 800 });
    const fbo = regl.framebuffer({ color: texture });

    const loop = regl.frame(() => {
      const time = +new Date() / 1000;
      const color = [1, (Math.cos(time) + 1) / 2, (Math.sin(time) + 1) / 2, 1];

      // draw triangle directly on LHS
      regl({
        viewport: {
          x: 0,
          y: 0,
          width: 400,
          height: 800,
        },
      })(() => {
        drawTri({ color });
      });

      // draw triangle onto FBO
      fbo.use(() => {
        drawTri({ color });
      });

      // draw FBO texture onto RHS
      regl({
        viewport: {
          x: 400,
          y: 0,
          width: 400,
          height: 800,
        },
      })(() => {
        drawTex({ tex1: texture });
      });
    });

    return () => {
      loop.cancel();
      fbo.destroy();
      texture.destroy();
      regl.destroy();
    };
  });

  return (
    <div className="min-w-full min-h-full p-10 prose box-border">
      <canvas
        width={800}
        height={800}
        ref={setCanvas}
        className="border border-black"
      />
    </div>
  );
};
