import { ensureTexSize, newTex } from "../../mygl.js";
import { defineOp, Sentence, SentenceParamSelect } from "../../ops-core.js";

export default defineOp({
  id: "built-in-video",
  initRuntime(ctx) {
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.autoplay = true;

    return {
      video,
      out: newTex(ctx.gl, 1920, 1080),
    };
  },
  initParams: () => ({ path: "Nature/Movie.1.mp4" }),
  run({ runtime, params, ctx }) {
    const { gl } = ctx;

    // HACK
    if (!runtime.video.src.endsWith(params.path)) {
      runtime.video.src = params.path;
      runtime.video.play();
    }

    if (runtime.video.readyState < 2) {
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
  Render(props) {
    return (
      <>
        <Sentence>
          Built-in video file{" "}
          <SentenceParamSelect
            value={props.params.path!}
            valueUP={props.paramsUP.path.$as<string>()}
            options={[
              { label: "Nature/Movie.1.mp4", value: "Nature/Movie.1.mp4" },
              { label: "Nature/Movie.2.mp4", value: "Nature/Movie.2.mp4" },
              { label: "Nature/Movie.3.mp4", value: "Nature/Movie.3.mp4" },
              { label: "Nature/Movie.4.mp4", value: "Nature/Movie.4.mp4" },
              { label: "Nature/Movie.5.mp4", value: "Nature/Movie.5.mp4" },
            ]}
          />
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
