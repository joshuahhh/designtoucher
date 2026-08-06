import {
  destroyFbo,
  ensureFboSize,
  newFbo,
  ShaderProgram,
} from "../../mygl.js";
import { defineOp, Sentence, SentenceParamNumber } from "../../ops-core.js";

const VERT = `
  attribute vec2 position;
  varying vec2 uv;
  void main() {
    uv = 0.5 * (position + 1.0);
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

export default defineOp({
  id: "optical-flow",
  inputKeys: ["in"] as const,
  outputKeys: ["x", "y"],
  initParams: () => ({
    sensitivity: 5,
    window: 2,
  }),
  initRuntime(ctx) {
    const { gl } = ctx;

    const currFbo = newFbo(gl);
    const prevFbo = newFbo(gl);
    const gradFbo = newFbo(gl);
    const flowFbo = newFbo(gl);
    const outXFbo = newFbo(gl);
    const outYFbo = newFbo(gl);

    const gradientProgram = new ShaderProgram(
      gl,
      VERT,
      `
      precision highp float;
      varying vec2 uv;
      uniform sampler2D curr;
      uniform sampler2D prev;
      uniform vec2 texel;

      float luma(vec3 c) {
        return dot(c, vec3(0.299, 0.587, 0.114));
      }

      void main() {
        float tl = luma(texture2D(curr, uv + vec2(-texel.x,  texel.y)).rgb);
        float tr = luma(texture2D(curr, uv + vec2( texel.x,  texel.y)).rgb);
        float l  = luma(texture2D(curr, uv + vec2(-texel.x,  0.0)).rgb);
        float r  = luma(texture2D(curr, uv + vec2( texel.x,  0.0)).rgb);
        float bl = luma(texture2D(curr, uv + vec2(-texel.x, -texel.y)).rgb);
        float br = luma(texture2D(curr, uv + vec2( texel.x, -texel.y)).rgb);
        float t  = luma(texture2D(curr, uv + vec2(0.0,  texel.y)).rgb);
        float b  = luma(texture2D(curr, uv + vec2(0.0, -texel.y)).rgb);

        float Ix = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
        float Iy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
        float It = luma(texture2D(curr, uv).rgb) - luma(texture2D(prev, uv).rgb);

        // The target is an unsigned byte texture, which clamps to [0, 1] —
        // bias-encode the signed gradients so negatives survive.
        // Ix, Iy are in [-4, 4] (Sobel of luma); encoded at 1/8 they never
        // clip. It is in [-1, 1].
        // The bias is 128/255, not 0.5: 0.5 lands between two byte values
        // (127.5), so a zero gradient wouldn't round-trip to zero, leaving a
        // DC offset that reads as phantom motion on a static image.
        gl_FragColor = vec4(
          Ix * 0.125 + 128.0 / 255.0,
          Iy * 0.125 + 128.0 / 255.0,
          It * 0.5 + 128.0 / 255.0,
          1.0
        );
      }
    `,
    );

    const flowProgram = new ShaderProgram(
      gl,
      VERT,
      `
      precision highp float;
      varying vec2 uv;
      uniform sampler2D grad;
      uniform vec2 texel;
      uniform float sensitivity;
      uniform float windowSize;

      void main() {
        float sumIxIx = 0.0, sumIyIy = 0.0, sumIxIy = 0.0;
        float sumIxIt = 0.0, sumIyIt = 0.0;

        for (int dy = -4; dy <= 4; dy++) {
          for (int dx = -4; dx <= 4; dx++) {
            vec2 d = vec2(float(dx), float(dy));
            if (abs(d.x) > windowSize || abs(d.y) > windowSize) continue;
            vec3 g = texture2D(grad, uv + d * texel).rgb;
            // decode the bias-encoded gradients (see gradient pass)
            float ix = (g.r - 128.0 / 255.0) * 8.0;
            float iy = (g.g - 128.0 / 255.0) * 8.0;
            float it = (g.b - 128.0 / 255.0) * 2.0;
            sumIxIx += ix * ix;
            sumIyIy += iy * iy;
            sumIxIy += ix * iy;
            sumIxIt += ix * it;
            sumIyIt += iy * it;
          }
        }

        // Tikhonov regularization: pulls the solve toward zero flow where
        // the window has weak gradient evidence, instead of letting a
        // near-singular tensor blow sensor noise up into random velocities.
        const float EPS = 0.05;
        sumIxIx += EPS;
        sumIyIy += EPS;

        float det = sumIxIx * sumIyIy - sumIxIy * sumIxIy;
        float vx = 0.0, vy = 0.0;
        if (abs(det) > 1e-6) {
          vx = (sumIyIy * (-sumIxIt) - sumIxIy * (-sumIyIt)) / det;
          vy = (sumIxIx * (-sumIyIt) - sumIxIy * (-sumIxIt)) / det;
        }

        // vy is negated: the solve works in texture coords (v axis points
        // up), but the output uses screen convention — down is positive.
        vx = clamp(vx * sensitivity * 0.1 + 128.0 / 255.0, 0.0, 1.0);
        vy = clamp(-vy * sensitivity * 0.1 + 128.0 / 255.0, 0.0, 1.0);

        gl_FragColor = vec4(vx, vy, 128.0 / 255.0, 1.0);
      }
    `,
    );

    const extractProgram = new ShaderProgram(
      gl,
      VERT,
      `
      precision mediump float;
      varying vec2 uv;
      uniform sampler2D flow;
      uniform int channel;
      void main() {
        vec4 f = texture2D(flow, uv);
        float v = channel == 0 ? f.r : f.g;
        gl_FragColor = vec4(v, v, v, 1.0);
      }
    `,
    );

    return {
      currFbo,
      prevFbo,
      gradFbo,
      flowFbo,
      outXFbo,
      outYFbo,
      gradientProgram,
      flowProgram,
      extractProgram,
      checkFb: gl.createFramebuffer()!,
      hasPrev: false,
      x: outXFbo.tex,
      y: outYFbo.tex,
    };
  },

  run({ inputs, params, runtime, ctx }) {
    const tex = inputs.in;
    if (!tex) return;

    const { gl, draw } = ctx;
    const w = tex.width;
    const h = tex.height;

    ensureFboSize(runtime.currFbo, w, h);
    ensureFboSize(runtime.prevFbo, w, h);
    ensureFboSize(runtime.gradFbo, w, h);
    ensureFboSize(runtime.flowFbo, w, h);
    ensureFboSize(runtime.outXFbo, w, h);
    ensureFboSize(runtime.outYFbo, w, h);

    // Snapshot the input into our own FBO so we have a stable copy —
    // upstream nodes (e.g. camera) mutate their texture in-place, so
    // reading `tex` directly would see the same pixels as prevFbo.
    draw({
      tex,
      targetFramebuffer: runtime.currFbo.framebuffer,
      viewport: [0, 0, w, h],
    });

    if (!runtime.hasPrev) {
      draw({
        tex: runtime.currFbo.tex,
        targetFramebuffer: runtime.prevFbo.framebuffer,
        viewport: [0, 0, w, h],
      });
      runtime.hasPrev = true;
      return;
    }

    // Compare a few pixels from currFbo and prevFbo to detect whether
    // the webcam actually delivered a new frame. When the webcam runs
    // slower than rAF, most frames are identical — skip those to keep
    // the last meaningful flow output rather than overwriting with zeros.
    const SAMPLE_W = 8;
    const currSample = new Uint8Array(SAMPLE_W * 4);
    const prevSample = new Uint8Array(SAMPLE_W * 4);
    const midY = Math.floor(h / 2);
    const midX = Math.floor(w / 2) - Math.floor(SAMPLE_W / 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, runtime.checkFb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      runtime.currFbo.tex.texture,
      0,
    );
    gl.readPixels(
      midX,
      midY,
      SAMPLE_W,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      currSample,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      runtime.prevFbo.tex.texture,
      0,
    );
    gl.readPixels(
      midX,
      midY,
      SAMPLE_W,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      prevSample,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let same = true;
    for (let i = 0; i < currSample.length; i++) {
      if (currSample[i] !== prevSample[i]) {
        same = false;
        break;
      }
    }
    if (same) return;

    const texel: [number, number] = [1 / w, 1 / h];

    runtime.gradientProgram.run({
      targetFramebuffer: runtime.gradFbo.framebuffer,
      viewport: [0, 0, w, h],
      uniforms: {
        curr: ["sampler2D", runtime.currFbo.tex.texture],
        prev: ["sampler2D", runtime.prevFbo.tex.texture],
        texel: ["2f", texel],
      },
      fullscreen: true,
    });

    runtime.flowProgram.run({
      targetFramebuffer: runtime.flowFbo.framebuffer,
      viewport: [0, 0, w, h],
      uniforms: {
        grad: ["sampler2D", runtime.gradFbo.tex.texture],
        texel: ["2f", texel],
        sensitivity: ["1f", params.sensitivity],
        windowSize: ["1f", params.window],
      },
      fullscreen: true,
    });

    runtime.extractProgram.run({
      targetFramebuffer: runtime.outXFbo.framebuffer,
      viewport: [0, 0, w, h],
      uniforms: {
        flow: ["sampler2D", runtime.flowFbo.tex.texture],
        channel: ["1i", 0],
      },
      fullscreen: true,
    });

    runtime.extractProgram.run({
      targetFramebuffer: runtime.outYFbo.framebuffer,
      viewport: [0, 0, w, h],
      uniforms: {
        flow: ["sampler2D", runtime.flowFbo.tex.texture],
        channel: ["1i", 1],
      },
      fullscreen: true,
    });

    // Swap: current snapshot becomes previous for next frame
    const tmp = runtime.prevFbo;
    runtime.prevFbo = runtime.currFbo;
    runtime.currFbo = tmp;
  },

  destroy({ runtime }) {
    destroyFbo(runtime.currFbo);
    destroyFbo(runtime.prevFbo);
    destroyFbo(runtime.gradFbo);
    destroyFbo(runtime.flowFbo);
    destroyFbo(runtime.outXFbo);
    destroyFbo(runtime.outYFbo);
    runtime.currFbo.gl.deleteFramebuffer(runtime.checkFb);
  },

  Render(props) {
    return (
      <>
        <Sentence>
          Optical flow of <props.InputHandle inputKey="in" />, sensitivity{" "}
          <SentenceParamNumber
            paramKey="sensitivity"
            value={props.params.sensitivity}
            valueUP={props.paramsUP.sensitivity}
            min={1}
            max={50}
            step={1}
          />{" "}
          window{" "}
          <SentenceParamNumber
            paramKey="window"
            value={props.params.window}
            valueUP={props.paramsUP.window}
            min={1}
            max={4}
            step={1}
          />
        </Sentence>
        <div className="flex">
          <props.OutputHandle outputKey="x" size={0.5}>
            <div className="absolute bottom-0 left-0 right-0 text-center text-[9px] text-white bg-black/50 leading-tight pointer-events-none">
              X
            </div>
          </props.OutputHandle>
          <props.OutputHandle outputKey="y" size={0.5}>
            <div className="absolute bottom-0 left-0 right-0 text-center text-[9px] text-white bg-black/50 leading-tight pointer-events-none">
              Y
            </div>
          </props.OutputHandle>
        </div>
      </>
    );
  },

  searchHints: [
    "AKA: motion, velocity, movement, lucas-kanade, temporal, displacement.",
  ],
});
