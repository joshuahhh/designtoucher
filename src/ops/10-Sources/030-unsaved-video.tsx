import { destroyTex, ensureTexSize, newTex } from "../../mygl.js";
import { defineOp, Sentence } from "../../ops-core.js";

export default defineOp({
  id: "unsaved-video",
  initRuntime(ctx) {
    return {
      video: null as HTMLVideoElement | null,
      out: newTex(ctx.gl, 1920, 1080),
    };
  },
  run({ runtime, ctx }) {
    const { gl } = ctx;

    if (!runtime.video) {
      return;
    }

    ensureTexSize(
      runtime.out,
      runtime.video.videoWidth,
      runtime.video.videoHeight,
    );

    gl.bindTexture(gl.TEXTURE_2D, runtime.out.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      runtime.video,
    );
  },
  destroy({ runtime }) {
    if (runtime.video) {
      runtime.video.pause();
      runtime.video.srcObject = null;
      runtime.video = null;
    }
    if (runtime.out) {
      destroyTex(runtime.out);
    }
  },
  RenderTop(props) {
    return (
      <Sentence>
        UNSAVED video file{" "}
        <span className="underline decoration-dotted">
          <input
            type="file"
            accept="video/*"
            onChange={(e) => {
              if (!props.runtime) {
                return;
              }
              if (e.target.files && e.target.files.length > 0) {
                const file = e.target.files[0];
                const video = document.createElement("video");
                video.src = URL.createObjectURL(file);
                video.crossOrigin = "anonymous";
                video.loop = true;
                video.muted = true;
                video.play();
                props.runtime.video = video;
              }
            }}
            className="text-[80%] w-36"
          />
        </span>
      </Sentence>
    );
  },
});
