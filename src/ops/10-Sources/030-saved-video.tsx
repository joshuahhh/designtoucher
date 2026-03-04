import { destroyTex, ensureTexSize, newTex } from "../../mygl.js";
import { defineOp, Sentence } from "../../ops-core.js";
import { idbGet, idbSet } from "../../useIDB.js";

function makeVideo(src: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.src = src;
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.play();
  return video;
}

export default defineOp({
  id: "saved-video",
  initParams: () => ({
    blobKey: null as string | null,
    fileName: null as string | null,
  }),
  initRuntime(ctx) {
    return {
      video: null as HTMLVideoElement | null,
      blobUrl: null as string | null,
      loadedBlobKey: null as string | null,
      loading: false,
      out: newTex(ctx.gl, 1920, 1080),
    };
  },
  run({ runtime, params, ctx, notify }) {
    const { gl } = ctx;

    // Restore video from IDB if we have a blobKey but haven't loaded it yet
    if (
      params.blobKey &&
      params.blobKey !== runtime.loadedBlobKey &&
      !runtime.loading
    ) {
      runtime.loading = true;
      idbGet<Blob>(`video:${params.blobKey}`).then((blob) => {
        runtime.loading = false;
        if (blob) {
          if (runtime.blobUrl) URL.revokeObjectURL(runtime.blobUrl);
          const url = URL.createObjectURL(blob);
          runtime.video = makeVideo(url);
          runtime.blobUrl = url;
          runtime.loadedBlobKey = params.blobKey;
          notify();
        }
      });
    }

    if (!runtime.video || runtime.video.readyState < 2) {
      return;
    }

    const prevW = runtime.out.width;
    const prevH = runtime.out.height;
    ensureTexSize(
      runtime.out,
      runtime.video.videoWidth,
      runtime.video.videoHeight,
    );
    if (runtime.out.width !== prevW || runtime.out.height !== prevH) {
      notify();
    }

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
      if (runtime.blobUrl) URL.revokeObjectURL(runtime.blobUrl);
      runtime.video = null;
      runtime.blobUrl = null;
    }
    if (runtime.out) {
      destroyTex(runtime.out);
    }
  },
  Render(props) {
    return (
      <>
        <Sentence>
          Video file{" "}
          <span className="underline decoration-dotted">
            {props.params.fileName ? (
              <span className="text-[80%]">
                {props.params.fileName}{" "}
                <button
                  className="text-red-400 hover:text-red-600"
                  onClick={() => {
                    if (props.runtime) {
                      props.runtime.video?.pause();
                      if (props.runtime.blobUrl)
                        URL.revokeObjectURL(props.runtime.blobUrl);
                      props.runtime.video = null;
                      props.runtime.blobUrl = null;
                      props.runtime.loadedBlobKey = null;
                    }
                    props.paramsUP.blobKey.$set(null);
                    props.paramsUP.fileName.$set(null);
                  }}
                >
                  ×
                </button>
              </span>
            ) : (
              <input
                type="file"
                accept="video/*"
                onChange={async (e) => {
                  if (!props.runtime) return;
                  const file = e.target.files?.[0];
                  if (!file) return;

                  const key = crypto.randomUUID();
                  await idbSet(`video:${key}`, file as Blob);

                  // Immediately create video for instant playback
                  if (props.runtime.blobUrl)
                    URL.revokeObjectURL(props.runtime.blobUrl);
                  const url = URL.createObjectURL(file);
                  props.runtime.video = makeVideo(url);
                  props.runtime.blobUrl = url;
                  props.runtime.loadedBlobKey = key;

                  props.paramsUP.blobKey.$set(key);
                  props.paramsUP.fileName.$set(file.name);
                }}
                className="text-[80%] w-36"
              />
            )}
          </span>
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
