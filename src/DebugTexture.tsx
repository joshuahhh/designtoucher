import { useEffect, useMemo, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { Tex } from "./mygl.js";
import { animate } from "./util.js";

export function dumpTexture(
  gl: WebGLRenderingContext,
  texture: WebGLTexture,
  width: number,
  height: number,
  canvas: HTMLCanvasElement,
): void {
  const pixels = new Uint8Array(width * height * 4);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindTexture(gl.TEXTURE_2D, null);
  drawPixels(pixels, width, height, canvas);
}

export function drawPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  canvas: HTMLCanvasElement,
) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);
}

let debugTexRootRef: { current: Root | null } = (window as any)
  .__debugTexRootRef ?? { current: null };
(window as any).__debugTexRootRef = debugTexRootRef;

export function debugTex(gl: WebGLRenderingContext, tex: Tex): void {
  if (!debugTexRootRef.current) {
    const div = document.createElement("div");
    document.body.appendChild(div);
    debugTexRootRef.current = createRoot(div);
  }
  debugTexRootRef.current.render(
    <DebugTex gl={gl} tex={tex} date={new Date()} />,
  );
}

const DebugTex = (props: {
  gl: WebGLRenderingContext;
  tex: Tex;
  date: Date;
}) => {
  const { gl, tex, date } = props;
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  // const [sum, setSum] = useState(0);

  // useEffect(() => {
  //   void date;
  //   if (!canvas) return;
  //   dumpTexture(gl, tex.texture, tex.width, tex.height, canvas);
  //   // const pixels = new Uint8Array(tex.width * tex.height * 4);
  //   // gl.readPixels(
  //   //   0,
  //   //   0,
  //   //   tex.width,
  //   //   tex.height,
  //   //   gl.RGBA,
  //   //   gl.UNSIGNED_BYTE,
  //   //   pixels,
  //   // );
  //   // setSum(pixels.reduce((acc, val) => acc + val, 0));
  // }, [gl, tex, canvas, date]);

  const pixels = usePixels(gl, tex);
  const sum = useMemo(() => {
    if (!pixels) return 0;
    return pixels.reduce((acc, val) => acc + val, 0);
  }, [pixels]);

  useEffect(() => {
    if (!canvas) return;
    drawPixels(
      pixels ?? new Uint8Array(tex.width * tex.height * 4),
      tex.width,
      tex.height,
      canvas,
    );
  }, [gl, tex, canvas, pixels]);

  return (
    <div style={{ position: "fixed", top: 0, right: 0, zIndex: 1000 }}>
      <canvas
        ref={setCanvas}
        className="debug-texture"
        style={{
          maxWidth: 400,
          maxHeight: 400,
          border: "1px solid black",
          background:
            "repeating-conic-gradient(#808080 0 25%, #0000 0 50%) 50% / 20px 20px",
        }}
      />
      <p>
        Texture: {tex.width} x {tex.height}
      </p>
      <p>Sum of pixels: {sum}</p>
      <p>Date: {date.toISOString()}</p>
    </div>
  );
};

const USE_PIXELS_DISABLED = true;

export const usePixels = (
  gl: WebGLRenderingContext,
  tex: Tex,
): Uint8Array | null => {
  const [pixels, setPixels] = useState<Uint8Array | null>(null);

  useEffect(() => {
    if (USE_PIXELS_DISABLED) return;
    return animate(() => {
      const newPixels = new Uint8Array(tex.width * tex.height * 4);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        tex.texture,
        0,
      );
      gl.readPixels(
        0,
        0,
        tex.width,
        tex.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        newPixels,
      );
      gl.bindTexture(gl.TEXTURE_2D, null);
      setPixels(newPixels);
    });
  }, [gl, tex]);

  return pixels;
};
