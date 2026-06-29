import { useState } from "react";
import { destroyTex, ensureTexSize, newTex } from "../../mygl.js";
import { defineOp, Sentence } from "../../ops-core.js";
import { idbGet, idbSet } from "../../useIDB.js";

type MediaKind = "video" | "image";

function makeVideo(src: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.src = src;
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.play();
  return video;
}

function makeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function detectKind(file: File): MediaKind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  return null;
}

export default defineOp({
  id: "saved-video",
  searchHints: ["image", "video", "file", "photo", "picture", "upload"],
  initParams: () => ({
    blobKey: null as string | null,
    fileName: null as string | null,
    mediaKind: null as MediaKind | null,
  }),
  initRuntime(ctx) {
    return {
      media: null as HTMLVideoElement | HTMLImageElement | null,
      blobUrl: null as string | null,
      loadedBlobKey: null as string | null,
      loading: false,
      out: newTex(ctx.gl, 1920, 1080),
    };
  },
  run({ runtime, params, ctx, notify }) {
    const { gl } = ctx;

    if (
      params.blobKey &&
      params.blobKey !== runtime.loadedBlobKey &&
      !runtime.loading
    ) {
      runtime.loading = true;
      idbGet<Blob>(`media:${params.blobKey}`).then(async (blob) => {
        runtime.loading = false;
        if (blob) {
          if (runtime.blobUrl) URL.revokeObjectURL(runtime.blobUrl);
          const url = URL.createObjectURL(blob);
          if (params.mediaKind === "image") {
            runtime.media = await makeImage(url);
          } else {
            runtime.media = makeVideo(url);
          }
          runtime.blobUrl = url;
          runtime.loadedBlobKey = params.blobKey;
          notify();
        }
      });
    }

    const media = runtime.media;
    if (!media) return;

    if (media instanceof HTMLVideoElement) {
      if (media.readyState < 2) return;
      const prevW = runtime.out.width;
      const prevH = runtime.out.height;
      ensureTexSize(runtime.out, media.videoWidth, media.videoHeight);
      if (runtime.out.width !== prevW || runtime.out.height !== prevH) {
        notify();
      }
    } else {
      ensureTexSize(runtime.out, media.naturalWidth, media.naturalHeight);
    }

    gl.bindTexture(gl.TEXTURE_2D, runtime.out.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);
  },
  destroy({ runtime }) {
    if (runtime.media) {
      if (runtime.media instanceof HTMLVideoElement) runtime.media.pause();
      if (runtime.blobUrl) URL.revokeObjectURL(runtime.blobUrl);
      runtime.media = null;
      runtime.blobUrl = null;
    }
    if (runtime.out) {
      destroyTex(runtime.out);
    }
  },
  Render(props) {
    const [dragOver, setDragOver] = useState(false);

    async function loadFile(file: File) {
      if (!props.runtime) return;
      const kind = detectKind(file);
      if (!kind) return;

      const key = crypto.randomUUID();
      await idbSet(`media:${key}`, file as Blob);

      if (props.runtime.blobUrl) URL.revokeObjectURL(props.runtime.blobUrl);
      const url = URL.createObjectURL(file);
      if (kind === "image") {
        props.runtime.media = await makeImage(url);
      } else {
        props.runtime.media = makeVideo(url);
      }
      props.runtime.blobUrl = url;
      props.runtime.loadedBlobKey = key;

      props.paramsUP.blobKey.$set(key);
      props.paramsUP.fileName.$set(file.name);
      props.paramsUP.mediaKind.$set(kind);
    }

    return (
      <>
        <Sentence>
          <span
            className={dragOver ? "bg-blue-500/30 rounded" : undefined}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) loadFile(file);
            }}
          >
            {props.params.fileName ? (
              <span className="text-[80%]">
                {props.params.fileName}{" "}
                <button
                  className="text-red-400 hover:text-red-600"
                  onClick={() => {
                    if (props.runtime) {
                      if (props.runtime.media instanceof HTMLVideoElement)
                        props.runtime.media.pause();
                      if (props.runtime.blobUrl)
                        URL.revokeObjectURL(props.runtime.blobUrl);
                      props.runtime.media = null;
                      props.runtime.blobUrl = null;
                      props.runtime.loadedBlobKey = null;
                    }
                    props.paramsUP.blobKey.$set(null);
                    props.paramsUP.fileName.$set(null);
                    props.paramsUP.mediaKind.$set(null);
                  }}
                >
                  ×
                </button>
              </span>
            ) : (
              <>
                Video file{" "}
                <input
                  type="file"
                  accept="video/*,image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) loadFile(file);
                  }}
                  className="text-[80%] w-36"
                />
              </>
            )}
          </span>
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
