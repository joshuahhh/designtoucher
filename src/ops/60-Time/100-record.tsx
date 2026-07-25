import { useEffect, useRef, useState } from "react";
import { destroyTex, ensureTexSize, newTex } from "../../mygl.js";
import { defineOp, Sentence, SentenceButton } from "../../ops-core.js";
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

async function webmToMp4(
  webmBlob: Blob,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  console.log(
    "[transcode] starting, input size:",
    (webmBlob.size / 1024 / 1024).toFixed(1) + "MB",
  );
  const t0 = performance.now();

  const {
    Conversion,
    Input,
    Output,
    BlobSource,
    BufferTarget,
    Mp4OutputFormat,
    WEBM,
  } = await import("mediabunny");

  console.log("[transcode] mediabunny loaded");

  const input = new Input({
    source: new BlobSource(webmBlob),
    formats: [WEBM],
  });
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });

  const conversion = await Conversion.init({
    input,
    output,
    video: { codec: "avc" },
    audio: { discard: true },
  });

  if (!conversion.isValid) {
    console.log("[transcode] discarded tracks:", conversion.discardedTracks);
    throw new Error("Conversion is not valid");
  }

  conversion.onProgress = (progress) => {
    console.log("[transcode] progress:", (progress * 100).toFixed(1) + "%");
    onProgress?.(progress);
  };

  console.log("[transcode] running conversion...");
  await conversion.execute();

  console.log(
    "[transcode] done in",
    ((performance.now() - t0) / 1000).toFixed(1) + "s",
  );

  const bytes = target.buffer!;
  return new Blob([new Uint8Array(bytes)], { type: "video/mp4" });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type SaveState =
  | { kind: "idle" }
  | { kind: "menu" }
  | { kind: "transcoding"; progress: number }
  | { kind: "error" };

function SaveButton({ blobKey }: { blobKey: string | null }) {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.kind !== "menu") return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setState({ kind: "idle" });
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [state.kind]);

  const saveWebm = async () => {
    if (!blobKey) return;
    const blob = await idbGet<Blob>(`video:${blobKey}`);
    if (blob) downloadBlob(blob, "recording.webm");
    setState({ kind: "idle" });
  };

  const saveMp4 = async () => {
    if (!blobKey) return;
    setState({ kind: "transcoding", progress: 0 });
    try {
      const webmBlob = await idbGet<Blob>(`video:${blobKey}`);
      if (!webmBlob) {
        setState({ kind: "error" });
        return;
      }
      const mp4Blob = await webmToMp4(webmBlob, (p) =>
        setState({ kind: "transcoding", progress: p }),
      );
      downloadBlob(mp4Blob, "recording.mp4");
      setState({ kind: "idle" });
    } catch (e) {
      console.log("transcode failed", e);
      setState({ kind: "error" });
    }
  };

  if (state.kind === "transcoding") {
    const pct = Math.round(state.progress * 100);
    return (
      <SentenceButton disabled className="relative overflow-hidden">
        <span
          className="absolute inset-0 bg-blue-500/20 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
        <span className="relative">{pct}%</span>
      </SentenceButton>
    );
  }

  if (state.kind === "error") {
    return (
      <SentenceButton
        onClick={() => setState({ kind: "menu" })}
        className="text-red-500"
      >
        Retry
      </SentenceButton>
    );
  }

  return (
    <span className="relative inline-block" ref={menuRef}>
      <SentenceButton onClick={() => setState({ kind: "menu" })}>
        Save
      </SentenceButton>
      {state.kind === "menu" && (
        <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 overflow-hidden text-xs whitespace-nowrap">
          <button
            className="block w-full px-3 py-1.5 text-left hover:bg-gray-100"
            onClick={saveWebm}
          >
            .webm
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left hover:bg-gray-100"
            onClick={saveMp4}
          >
            .mp4
          </button>
        </div>
      )}
    </span>
  );
}

export default defineOp({
  id: "record",
  inputKeys: ["in"],
  initParams: () => ({
    blobKey: null as string | null,
  }),
  initRuntime(ctx, notify) {
    return {
      _notify: notify,
      // Playback
      video: null as HTMLVideoElement | null,
      blobUrl: null as string | null,
      loadedBlobKey: null as string | null,
      loading: false,
      // Recording
      recording: false,
      mediaRecorder: null as MediaRecorder | null,
      recordCanvas: null as HTMLCanvasElement | null,
      recordCanvasCtx: null as CanvasRenderingContext2D | null,
      recordFb: null as WebGLFramebuffer | null,
      recordChunks: [] as Blob[],
      // Output
      out: newTex(ctx.gl, 1280, 720),
    };
  },
  run({ runtime, inputs, params, ctx, notify }) {
    const { gl } = ctx;
    const input = inputs.in;

    // Restore video from IDB
    if (
      params.blobKey &&
      params.blobKey !== runtime.loadedBlobKey &&
      !runtime.loading &&
      !runtime.recording
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

    // Pass-through: copy input to output (during recording or when idle with no video)
    const shouldPassThrough = input && (runtime.recording || !runtime.video);
    if (shouldPassThrough) {
      if (!runtime.recordFb) {
        runtime.recordFb = gl.createFramebuffer()!;
      }

      // Read pixels from input texture
      gl.bindFramebuffer(gl.FRAMEBUFFER, runtime.recordFb);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        input.texture,
        0,
      );
      const pixels = new Uint8ClampedArray(input.width * input.height * 4);
      gl.readPixels(
        0,
        0,
        input.width,
        input.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Feed recording canvas if recording
      if (runtime.recording) {
        const canvas = runtime.recordCanvas;
        const ctx2d = runtime.recordCanvasCtx;
        if (canvas && ctx2d) {
          if (canvas.width !== input.width || canvas.height !== input.height) {
            canvas.width = input.width;
            canvas.height = input.height;
          }
          // Flip Y (WebGL bottom-up -> canvas top-down)
          const imageData = new ImageData(input.width, input.height);
          const rowSize = input.width * 4;
          for (let y = 0; y < input.height; y++) {
            imageData.data.set(
              pixels.subarray(
                (input.height - 1 - y) * rowSize,
                (input.height - y) * rowSize,
              ),
              y * rowSize,
            );
          }
          ctx2d.putImageData(imageData, 0, 0);
        }
      }

      // Copy to output texture
      ensureTexSize(runtime.out, input.width, input.height);
      gl.bindTexture(gl.TEXTURE_2D, runtime.out.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        input.width,
        input.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
    }
    // Playback: upload video frame to output
    else if (runtime.video && runtime.video.readyState >= 2) {
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
    }
  },
  destroy({ runtime, ctx }) {
    if (runtime.mediaRecorder && runtime.mediaRecorder.state !== "inactive") {
      runtime.mediaRecorder.stop();
    }
    if (runtime.video) {
      runtime.video.pause();
      if (runtime.blobUrl) URL.revokeObjectURL(runtime.blobUrl);
    }
    if (runtime.recordFb) {
      ctx.gl.deleteFramebuffer(runtime.recordFb);
    }
    destroyTex(runtime.out);
  },
  Render(props) {
    const startRecording = () => {
      const runtime = props.runtime;
      if (!runtime) return;

      // Clean up existing playback
      if (runtime.video) {
        runtime.video.pause();
        if (runtime.blobUrl) URL.revokeObjectURL(runtime.blobUrl);
        runtime.video = null;
        runtime.blobUrl = null;
        runtime.loadedBlobKey = null;
      }

      // Create canvas for MediaRecorder
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      runtime.recordCanvas = canvas;
      runtime.recordCanvasCtx = canvas.getContext("2d")!;

      // Set up MediaRecorder
      const stream = canvas.captureStream();
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm",
        videoBitsPerSecond: 2_500_000,
      });
      runtime.recordChunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) runtime.recordChunks.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(runtime.recordChunks, { type: "video/webm" });
        runtime.recordChunks = [];

        const key = crypto.randomUUID();
        await idbSet(`video:${key}`, blob);

        if (runtime.blobUrl) URL.revokeObjectURL(runtime.blobUrl);
        const url = URL.createObjectURL(blob);
        runtime.video = makeVideo(url);
        runtime.blobUrl = url;
        runtime.loadedBlobKey = key;

        props.paramsUP.blobKey.$set(key);

        runtime.recordCanvas = null;
        runtime.recordCanvasCtx = null;
        runtime._notify();
      };

      runtime.mediaRecorder = recorder;
      runtime.recording = true;
      recorder.start();
      runtime._notify();
    };

    const stopRecording = () => {
      const runtime = props.runtime;
      if (!runtime) return;
      runtime.recording = false;
      if (runtime.mediaRecorder && runtime.mediaRecorder.state !== "inactive") {
        runtime.mediaRecorder.stop();
      }
      runtime._notify();
    };

    return (
      <>
        <Sentence>
          Record <props.InputHandle inputKey="in" />{" "}
          {props.runtime?.recording ? (
            <SentenceButton onClick={stopRecording} className="text-red-500">
              Stop
            </SentenceButton>
          ) : (
            <>
              <SentenceButton onClick={startRecording}>Rec</SentenceButton>
              {props.params.blobKey && (
                <>
                  {" "}
                  <SaveButton blobKey={props.params.blobKey} />{" "}
                  <button
                    className="text-red-400 hover:text-red-600 text-xs"
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
                    }}
                  >
                    x
                  </button>
                </>
              )}
            </>
          )}
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["record", "capture", "save"],
});
