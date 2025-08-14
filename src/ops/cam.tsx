import { newTex, Tex } from "../mygl.js";
import {
  defineOp,
  instantiateOp,
  OpInstanceOf,
  Sentence,
  SentenceParamSelect,
} from "../ops-core.js";
import {
  assuredlyVideo,
  enumerateCameras,
  startStream,
  WebcamStream,
} from "../webcam.js";
import h_flip from "./h-flip.js";

export default defineOp({
  id: "cam" as const,
  initRuntime(ctx) {
    return {
      webcamStream: null as WebcamStream | null,
      tex: null as Tex | null,
      hflipOp: null as OpInstanceOf<typeof h_flip> | null,

      cams: null as MediaDeviceInfo[] | null,
      defaultDeviceId: null as string | null,

      out: null as Tex | null,
    };
  },
  run({ runtime, inputs, paramValues, ctx }) {
    const { gl } = ctx;

    if (!runtime.cams) {
      (async () => {
        // This is a memoized promise so it's ok to call it multiple times
        runtime.cams = await enumerateCameras();
      })();
      return;
    }

    const deviceId = paramValues["deviceId"] ?? runtime.defaultDeviceId;

    // TODO: this is extremely chaotic code; I don't like it
    // concretely: I think switching cameras causes a cascade of open operations
    // and the lack of access to paramValues sucks
    // but... it just barely works

    if (!runtime.webcamStream || runtime.webcamStream.deviceId !== deviceId) {
      if (deviceId) {
        // try to find the camera by deviceId
        const cam = runtime.cams.find((d) => d.deviceId === deviceId);
        if (cam) {
          (async () => {
            runtime.webcamStream = await startStream(cam.deviceId, 1920);
          })();
          return;
        }
      }

      // find facetime cam
      let camToUse = runtime.cams.find((d) => d.label.includes("FaceTime"));
      // const facetimeCam = cams.find((d) => d.label.includes("OBS"));
      if (!camToUse) {
        console.warn("No FaceTime camera found, using first video input");
        if (runtime.cams.length === 0) {
          throw new Error("No video input devices found");
        }
        camToUse = runtime.cams[0];
      }

      runtime.defaultDeviceId = camToUse.deviceId;
      (async () => {
        runtime.webcamStream = await startStream(camToUse.deviceId, 1920);
      })();
      return;

      // console.log(
      //   "Webcam stream started",
      //   this.webcamStream.width,
      //   this.webcamStream.height,
      // );
    }

    const video = assuredlyVideo(runtime.webcamStream.video);

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      console.warn("webcam lost readiness", video.readyState);
      return;
    }

    if (!runtime.tex) {
      console.log(
        "Creating new texture for webcam stream",
        runtime.webcamStream.width,
        runtime.webcamStream.height,
      );
      runtime.tex = newTex(
        ctx.gl,
        runtime.webcamStream.width,
        runtime.webcamStream.height,
      );
    }

    gl.bindTexture(gl.TEXTURE_2D, runtime.tex.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    // console.log("BEFORE texSubImage2D");
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
    // console.log("AFTER texSubImage2D");
    runtime.tex.width = runtime.webcamStream.width;
    runtime.tex.height = runtime.webcamStream.height;

    if (!runtime.webcamStream.facingMode.includes("environment")) {
      if (!runtime.hflipOp) {
        // TODO: fill in the op
        runtime.hflipOp = instantiateOp(h_flip, ctx);
      }

      h_flip.run!({
        runtime: runtime.hflipOp.runtime,
        inputs: { tex1: runtime.tex },
        paramValues: {},
        ctx,
      });

      runtime.out = (runtime.hflipOp.runtime as any).out as Tex;
    } else {
      if (runtime.hflipOp) {
        h_flip.destroy!({
          runtime: runtime.hflipOp.runtime,
          ctx,
        });
        runtime.hflipOp = null;
      }

      runtime.out = runtime.tex;
    }
  },
  RenderTop: (props) => {
    const cams = props.runtime?.cams;
    return (
      <Sentence>
        Camera{" "}
        {/* <span className="underline decoration-dotted">FaceTime camera</span> */}
        {cams ? (
          <SentenceParamSelect
            varName="deviceId"
            paramValues={props.paramValues}
            paramValuesUP={props.paramValuesUP}
            options={cams.map((cam) => ({
              label: cam.label,
              value: cam.deviceId,
            }))}
          />
        ) : (
          "..."
        )}
      </Sentence>
    );
  },
});
