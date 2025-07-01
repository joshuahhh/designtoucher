import { useEffect, useMemo, useState } from "react";
import "./color.js";
import { Demo } from "./color.js";
import dims from "./dims.js";
import DomNode from "./DomNode.js";
import { onVideoFrame } from "./util.js";
import { useWebcam } from "./webcam.js";

export function Amplify() {
  const [viewMode, setViewMode] = useState<"dry" | "wet" | "both">("both");

  const shouldUseTestVideo = false;
  const webcam = useWebcam({
    enabled: !shouldUseTestVideo,
    // preference: "Iriun",
    width: 640,
    preference: "FaceTime",
  });
  const video = useMemo(() => {
    if (shouldUseTestVideo) {
      // const video = document.createElement("video");
      // video.autoplay = true;
      // video.src = "/train-cut.webm";
      // video.volume = 0;
      // video.loop = true;
      // video.play();
      // return video;
      const video = document.createElement("img");
      video.src = "http://localhost:8081/cam.mjpeg";
      return video;
    } else {
      return webcam.stream?.video;
    }
  }, [shouldUseTestVideo, webcam.stream?.video]);
  const [isMirrored, setIsMirrored] = useState<boolean>(!shouldUseTestVideo);

  const [demo, setDemo] = useState<Demo | undefined>(undefined);

  useEffect(() => {
    if (!video) {
      return;
    }

    const cancel = onVideoFrame(video, () => {
      if (video instanceof HTMLImageElement || video.readyState >= 2) {
        if (!demo) {
          const [ow, oh] =
            video instanceof HTMLImageElement ? [864, 432] : dims(video);
          const w = Math.floor(ow >> 3) << 3,
            h = Math.floor(oh >> 3) << 3;
          console.log("Creating new Demo instance with", w, h);
          const demo = new Demo(w, h);
          setDemo(new Demo(w, h));
          demo.ctx.drawImage(video, 0, 0, demo.vidWidth, demo.vidHeight);
          demo.run();
        } else {
          demo.ctx.drawImage(video, 0, 0, demo.vidWidth, demo.vidHeight);
          demo.run();
        }
      }
    });
    return () => {
      cancel();
    };
  }, [video, demo]);

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === " ") {
        setViewMode((prev) => (prev === "wet" ? "dry" : "wet"));
      } else if (e.key === "b") {
        setViewMode("both");
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [video, isMirrored]);

  const dry = (
    <DomNode
      node={video}
      apply={(node) => (node.style.width = "100%")}
      style={isMirrored ? { transform: "scaleX(-1)" } : {}}
    />
  );

  const wet = demo ? (
    <DomNode
      node={demo.canvas}
      apply={(node) => (node.style.width = "100%")}
      style={isMirrored ? { transform: "scaleX(-1)" } : {}}
    />
  ) : (
    <div>Loading...</div>
  );

  return (
    <div className="flex flex-col text-white">
      <div className="flex">
        {viewMode === "dry" && dry}
        {viewMode === "wet" && wet}
        {viewMode === "both" && (
          <>
            <div className="flex-1">{dry}</div>
            <div className="flex-1">{wet}</div>
          </>
        )}
      </div>
      <div>
        <label htmlFor="exa">exa: </label>
        <input
          type="range"
          min={0}
          max={5}
          step={0.01}
          defaultValue={2}
          onChange={(e) => {
            if (demo) demo.exaggeration_factor = parseFloat(e.target.value);
          }}
        />
        <label htmlFor="alpha">&alpha;: </label>
        <input
          type="range"
          min={1}
          max={100}
          step={0.01}
          defaultValue={10}
          onChange={(e) => {
            if (demo) demo.alpha = parseFloat(e.target.value);
          }}
        />
        <label htmlFor="lambdac">&lambda;c: </label>
        <input
          type="range"
          min={1}
          max={90}
          step={0.01}
          defaultValue={16}
          onChange={(e) => {
            if (demo) demo.lambda_c = parseFloat(e.target.value);
          }}
        />
        <label htmlFor="chroma">chr: </label>
        <input
          type="range"
          min={0}
          max={10}
          step={0.01}
          defaultValue={1}
          onChange={(e) => {
            if (demo) demo.chromAttenuation = parseFloat(e.target.value);
          }}
        />
        <label htmlFor="r1">r1: </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          defaultValue={0.4}
          onChange={(e) => {
            if (demo) demo.r1 = parseFloat(e.target.value);
          }}
        />
        <label htmlFor="r2">r2: </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          defaultValue={0.05}
          onChange={(e) => {
            if (demo) demo.r2 = parseFloat(e.target.value);
          }}
        ></input>
      </div>
    </div>
  );
}
