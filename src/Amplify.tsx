import { useEffect, useReducer, useState } from "react";
import "./color.js";
import { Demo } from "./color.js";
import dims from "./dims.js";
import DomNode from "./DomNode.js";
import { onVideoFrame } from "./util.js";
import { useWebcam } from "./webcam.js";

export function Amplify() {
  const shouldUseTestVideo = false;
  const webcam = useWebcam({
    width: 640,
    preference: "FaceTime",
    vidOverrideExt: shouldUseTestVideo ? "Nature/Movie.1.mp4" : undefined,
    isMirrored: !shouldUseTestVideo,
  });
  const video = webcam.stream?.video;
  const isMirrored = webcam.isMirrored;

  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const [demo, setDemo] = useState<Demo | undefined>(undefined);

  useEffect(() => {
    // reset Demo on hot reload
    setDemo(undefined);
  }, []);

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

  const dry = video ? (
    <DomNode
      node={video}
      apply={(node) => (node.style.width = "100%")}
      style={isMirrored ? { transform: "scaleX(-1)" } : {}}
    />
  ) : (
    <div>Loading dry ...</div>
  );

  const wet = demo ? (
    <DomNode
      node={demo.canvas}
      apply={(node) => (node.style.width = "100%")}
      style={isMirrored ? { transform: "scaleX(-1)" } : {}}
    />
  ) : (
    <div>Loading wet ...</div>
  );

  return (
    <div className="flex flex-col">
      hello 1000
      <div className="flex">
        <div className="flex-1">{dry}</div>
        <div className="flex-1">{wet}</div>
      </div>
      {demo && (
        <div className="grid grid-cols-[min-content_min-content_min-content] p-4 gap-2">
          <input
            type="range"
            min={0}
            max={5}
            step={0.01}
            defaultValue={2}
            onChange={(e) => {
              demo.exaggeration_factor = parseFloat(e.target.value);
              forceUpdate();
            }}
          />
          <label className="pl-3">exaggeration_factor</label>
          <div>{demo.exaggeration_factor}</div>

          <input
            type="range"
            min={1}
            max={100}
            step={0.01}
            defaultValue={10}
            onChange={(e) => {
              demo.alpha = parseFloat(e.target.value);
              forceUpdate();
            }}
          />
          <label className="pl-3">&alpha;</label>
          <div>{demo.alpha}</div>

          <input
            type="range"
            min={1}
            max={90}
            step={0.01}
            defaultValue={16}
            onChange={(e) => {
              demo.lambda_c = parseFloat(e.target.value);
              forceUpdate();
            }}
          />
          <label className="pl-3">&lambda;c</label>
          <div>{demo.lambda_c}</div>

          <input
            type="range"
            min={0}
            max={10}
            step={0.01}
            defaultValue={1}
            onChange={(e) => {
              demo.chromAttenuation = parseFloat(e.target.value);
              forceUpdate();
            }}
          />
          <label className="pl-3">chromAttenuation</label>
          <div>{demo.chromAttenuation}</div>

          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            defaultValue={0.4}
            onChange={(e) => {
              demo.r1 = parseFloat(e.target.value);
              forceUpdate();
            }}
          />
          <label className="pl-3">r1</label>
          <div>{demo.r1}</div>

          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            defaultValue={0.05}
            onChange={(e) => {
              demo.r2 = parseFloat(e.target.value);
              forceUpdate();
            }}
          />
          <label className="pl-3">r2</label>
          <div>{demo.r2}</div>
        </div>
      )}
    </div>
  );
}
