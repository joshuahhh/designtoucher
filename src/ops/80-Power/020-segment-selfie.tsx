import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import {
  destroyFbo,
  destroyTex,
  ensureFboSize,
  newFbo,
  ShaderProgram,
  Tex,
} from "../../mygl.js";
import { defineOp, Sentence } from "../../ops-core.js";

// Display order; maskIdx is the model's output index
const CATEGORIES = [
  { key: "face", maskIdx: 3 },
  { key: "hair", maskIdx: 1 },
  { key: "body", maskIdx: 2 },
  { key: "clothes", maskIdx: 4 },
  { key: "other", maskIdx: 5 },
  { key: "bg", maskIdx: 0 },
] as const;
const FEED_SIZE = 256;

function createMaskTex(gl: WebGL2RenderingContext, w: number, h: number): Tex {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R8,
    w,
    h,
    0,
    gl.RED,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { texture, width: w, height: h, gl };
}

function flipY(data: Uint8Array, width: number, height: number) {
  const rowBytes = width * 4;
  const half = height >> 1;
  const tmp = new Uint8Array(rowBytes);
  for (let y = 0; y < half; y++) {
    const top = y * rowBytes;
    const bot = (height - 1 - y) * rowBytes;
    tmp.set(data.subarray(top, top + rowBytes));
    data.copyWithin(top, bot, bot + rowBytes);
    data.set(tmp, bot);
  }
}

export default defineOp({
  id: "segment-selfie",
  inputKeys: ["img"] as const,
  outputKeys: ["bg", "hair", "body", "face", "clothes", "other"],

  initRuntime(ctx, notify) {
    const { gl } = ctx;

    const feedCanvas = document.createElement("canvas");
    feedCanvas.width = FEED_SIZE;
    feedCanvas.height = FEED_SIZE;
    const feedCtx = feedCanvas.getContext("2d")!;

    const feedFbo = newFbo(gl);
    ensureFboSize(feedFbo, FEED_SIZE, FEED_SIZE);

    const maskTex = createMaskTex(gl, FEED_SIZE, FEED_SIZE);
    const maskBuf = new Uint8Array(FEED_SIZE * FEED_SIZE);
    const pixelBuf = new Uint8Array(FEED_SIZE * FEED_SIZE * 4);

    const compositeProgram = new ShaderProgram(
      gl,
      `
        attribute vec2 position;
        varying vec2 uv;
        void main() {
          uv = 0.5 * (position + 1.0);
          gl_Position = vec4(position, 0.0, 1.0);
        }
      `,
      `
        precision mediump float;
        uniform sampler2D img;
        uniform sampler2D mask;
        varying vec2 uv;
        void main() {
          vec4 color = texture2D(img, uv);
          float alpha = texture2D(mask, uv).r;
          gl_FragColor = vec4(color.rgb, alpha);
        }
      `,
    );

    const catFbos = CATEGORIES.map(() => newFbo(gl));

    const runtime = {
      segmenter: null as ImageSegmenter | null,
      loading: true,
      error: null as string | null,
      feedCanvas,
      feedCtx,
      feedFbo,
      pixelBuf,
      maskTex,
      maskBuf,
      compositeProgram,
      catFbos,
      // 6 named outputs
      bg: null as Tex | null,
      hair: null as Tex | null,
      body: null as Tex | null,
      face: null as Tex | null,
      clothes: null as Tex | null,
      other: null as Tex | null,
    };

    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks("./mediapipe");
        runtime.segmenter = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "./models/selfie_multiclass_256x256.tflite",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
        runtime.loading = false;
        notify();
      } catch (err) {
        console.error("Failed to load segmenter:", err);
        runtime.error = String(err);
        runtime.loading = false;
        notify();
      }
    })();

    return runtime;
  },

  run({ runtime, inputs, ctx }) {
    const img = inputs.img;
    if (!img || !runtime.segmenter) return;

    const { gl } = ctx;

    // 1. Downsample input to feed FBO
    ctx.draw({
      tex: img,
      targetFramebuffer: runtime.feedFbo.framebuffer,
      viewport: [0, 0, FEED_SIZE, FEED_SIZE],
    });

    // 2. Read pixels from feed FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, runtime.feedFbo.framebuffer);
    gl.readPixels(
      0,
      0,
      FEED_SIZE,
      FEED_SIZE,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      runtime.pixelBuf,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 3. Flip Y (WebGL bottom-up → canvas top-down)
    flipY(runtime.pixelBuf, FEED_SIZE, FEED_SIZE);

    // 4. Put pixels on feed canvas
    runtime.feedCtx.putImageData(
      new ImageData(
        new Uint8ClampedArray(runtime.pixelBuf.buffer),
        FEED_SIZE,
        FEED_SIZE,
      ),
      0,
      0,
    );

    // 5. Run segmentation, composite all 6 outputs
    runtime.segmenter.segmentForVideo(
      runtime.feedCanvas,
      performance.now(),
      (result) => {
        if (!result.confidenceMasks) return;
        for (let catIdx = 0; catIdx < CATEGORIES.length; catIdx++) {
          const { key, maskIdx } = CATEGORIES[catIdx];
          const maskFloat = result.confidenceMasks[maskIdx].getAsFloat32Array();
          for (let i = 0; i < maskFloat.length; i++) {
            runtime.maskBuf[i] = (maskFloat[i] * 255) | 0;
          }

          // Upload mask
          gl.bindTexture(gl.TEXTURE_2D, runtime.maskTex.texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            FEED_SIZE,
            FEED_SIZE,
            gl.RED,
            gl.UNSIGNED_BYTE,
            runtime.maskBuf,
          );
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
          gl.bindTexture(gl.TEXTURE_2D, null);

          // Composite into this category's FBO
          const fbo = runtime.catFbos[catIdx];
          ensureFboSize(fbo, img.width, img.height);
          runtime.compositeProgram.run({
            targetFramebuffer: fbo.framebuffer,
            viewport: [0, 0, img.width, img.height],
            uniforms: {
              img: ["sampler2D", img.texture],
              mask: ["sampler2D", runtime.maskTex.texture],
            },
            fullscreen: true,
          });

          runtime[key] = fbo.tex;
        }
      },
    );
  },

  destroy({ runtime }) {
    runtime.segmenter?.close();
    destroyFbo(runtime.feedFbo);
    for (const fbo of runtime.catFbos) destroyFbo(fbo);
    destroyTex(runtime.maskTex);
  },

  Render(props) {
    const loading = props.runtime?.loading ?? true;
    const error = props.runtime?.error;
    return (
      <>
        <Sentence>
          Segment selfie <props.InputHandle inputKey="img" />
          {error ? (
            <span title={error}> — error</span>
          ) : loading ? (
            " — loading..."
          ) : null}
        </Sentence>
        <div className="flex">
          {CATEGORIES.map(({ key }) => (
            <props.OutputHandle key={key} outputKey={key} size={1 / 3}>
              <div className="absolute bottom-0 left-0 right-0 text-center text-[9px] text-white bg-black/50 leading-tight pointer-events-none">
                {key}
              </div>
            </props.OutputHandle>
          ))}
        </div>
      </>
    );
  },

  searchHints: [
    "AKA: segmentation, person, selfie, hair, face, body, clothes, background, mediapipe.",
  ],
});
