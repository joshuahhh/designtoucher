import { Framebuffer2D, Regl, Texture2D } from "regl";

export type Fbo = Framebuffer2D & {
  texture: Texture2D;
};

export function Fbo(regl: Regl): Fbo {
  const texture = regl.texture();
  const fbo = regl.framebuffer({ color: texture }) as Fbo;
  fbo.texture = texture;
  return fbo;
}
