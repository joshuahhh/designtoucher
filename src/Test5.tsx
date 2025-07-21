import { useEffect, useState } from "react";
import { deleteFbo, ensureFboSize, newFbo, ShaderProgram } from "./mygl.js";

export const Test5 = () => {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvas) return;

    const gl = canvas.getContext("webgl")!;

    const triProgram = new ShaderProgram(
      gl,
      `
      attribute vec2 position;
      void main() {
        gl_Position = vec4(position, 0, 1);
      }
      `,
      `
      precision mediump float;
      uniform vec4 color;
      void main() {
        gl_FragColor = color;
      }
    `,
    );

    const texProgram = new ShaderProgram(
      gl,
      `
      attribute vec2 position;
      varying vec2 uv;
      void main() {
        uv = 0.5 * (position + 1.0);
        gl_Position = vec4(position, 0, 1);
      }
      `,
      `
      precision mediump float;
      varying vec2 uv;
      uniform sampler2D tex1;
      void main() {
        gl_FragColor = texture2D(tex1, uv);
      }
    `,
    );

    const positionBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
      gl.STATIC_DRAW,
    );

    const indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 2, 2, 3, 0]),
      gl.STATIC_DRAW,
    );

    const fbo = newFbo(gl);
    ensureFboSize(fbo, 400, 800);

    let animationFrame: number;
    function render() {
      const time = Date.now() / 1000;
      const color = [1, (Math.cos(time) + 1) / 2, (Math.sin(time) + 1) / 2, 1];

      triProgram.run({
        targetFramebuffer: null,
        viewport: [0, 0, 400, 800],
        uniforms: { color: ["4fv", color] },
        attributes: {
          position: positionBuffer,
        },
        indexBuffer,
      });
      triProgram.run({
        targetFramebuffer: fbo.framebuffer,
        viewport: [0, 0, 400, 800],
        uniforms: { color: ["4fv", color] },
        attributes: {
          position: positionBuffer,
        },
        indexBuffer,
      });
      texProgram.run({
        targetFramebuffer: null,
        viewport: [400, 0, 400, 800],
        uniforms: { tex1: ["sampler2D", fbo.texture] },
        attributes: {
          position: positionBuffer,
        },
        indexBuffer,
      });

      animationFrame = requestAnimationFrame(render);
    }

    render();

    return () => {
      cancelAnimationFrame(animationFrame);
      deleteFbo(fbo);
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(indexBuffer);
    };
  }, [canvas]);

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
