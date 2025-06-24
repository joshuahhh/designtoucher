import {
  ChangeEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import reglConstructor, { Texture2D, Texture2DOptions } from "regl";
import { onVideoFrame } from "./util.js";

type ReglProps = { texCurr: Texture2D; texPrev: Texture2D };

export const Root = memo(() => (
  <div className="w-screen h-screen bg-black flex flex-col items-center justify-center">
    <Canvas />
  </div>
));

const Canvas = memo(() => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [windowSize, setWindowSize] = useState<{
    width: number;
    height: number;
  }>({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [videoSize, setVideoSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const stopStream = useCallback(() => {
    if (videoRef.current?.srcObject instanceof MediaStream) {
      for (const track of videoRef.current.srcObject.getTracks()) {
        track.stop();
      }
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  const startStream = useCallback((deviceId: string) => {
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    videoRef.current = video;

    const constraints: MediaStreamConstraints = {
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };

    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      video.srcObject = stream;
      video.play();
      // get size, once available
      video.onloadedmetadata = () => {
        setVideoSize({
          width: video.videoWidth,
          height: video.videoHeight,
        });
      };
    });
  }, []);

  useEffect(() => {
    // enumerate cameras
    navigator.mediaDevices.enumerateDevices().then((all) => {
      const cams = all.filter((d) => d.kind === "videoinput");
      setDevices(cams);
      if (cams.length && !deviceId) setDeviceId(cams[0].deviceId);
    });
  }, [deviceId]);

  useEffect(() => {
    if (deviceId !== null) {
      stopStream();
      startStream(deviceId);
    }
  }, [deviceId, startStream, stopStream]);

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setDeviceId(e.target.value);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const regl = reglConstructor({ canvas });

    const draw = regl({
      frag: `
        precision mediump float;
        uniform sampler2D texCurr, texPrev;
        varying vec2 uv;
        void main () {
          vec3 old = texture2D(texPrev, uv).rgb;
          vec3 new = texture2D(texCurr, uv).rgb;
          vec3 diff = abs(new - old);
          // float sum = diff.r + diff.g + diff.b;
          // gl_FragColor = vec4(new * (0.5 + 0.5 * sum), 1.0);
          gl_FragColor = vec4(diff * 9.0, 1.0);
          // gl_FragColor = vec4(new, 1.0);
        }`,
      vert: `
        precision mediump float;
        attribute vec2 position;
        varying vec2 uv;
        void main () {
          uv = 0.5 * (position + 1.0);
          gl_Position = vec4(position, 0.0, 1.0);
        }`,
      attributes: { position: [-1, -1, 1, -1, -1, 1, 1, 1] },
      elements: [
        [0, 1, 2],
        [2, 1, 3],
      ],
      uniforms: {
        texCurr: regl.prop<ReglProps, "texCurr">("texCurr"),
        texPrev: regl.prop<ReglProps, "texPrev">("texPrev"),
      },
    });

    let texCurr: Texture2D | null = null;
    let texPrev: Texture2D | null = null;

    let cancel = () => {};

    const initFrameLoop = () => {
      const video = videoRef.current;
      if (!video) return;

      cancel = onVideoFrame(video, () => {
        if (video.readyState >= 2) {
          const opts: Texture2DOptions = { data: video, flipY: true };
          [texCurr, texPrev] = [texPrev, texCurr];
          if (!texCurr) {
            texCurr = regl.texture(opts);
          } else {
            texCurr(opts);
          }
          if (texPrev) {
            regl.poll();
            draw({ texCurr, texPrev });
          }
        }
      });
    };

    initFrameLoop();

    return () => {
      cancel();
      regl.destroy();
      stopStream();
    };
  }, [deviceId, stopStream]);

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!canvas) return;

    // scale canvas to window size, keeping aspect ratio of video
    if (!videoSize) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(
      windowSize.width / videoSize.width,
      windowSize.height / videoSize.height,
    );
    const w = videoSize.width * scale;
    const h = videoSize.height * scale;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    // regl._gl.viewport(0, 0, canvas.width, canvas.height);
  }, [videoSize, windowSize]);

  return (
    <>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
        <select
          className="mb-2 p-1 text-sm"
          value={deviceId ?? ""}
          onChange={handleChange}
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Unnamed camera"}
            </option>
          ))}
        </select>
      </div>
      <canvas ref={canvasRef} className="block" />
    </>
  );
});
