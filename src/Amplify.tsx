import { useEffect, useMemo, useState } from "react";
import "./color.js";
import { Demo } from "./color.js";
import DomNode from "./DomNode.js";
import { onVideoFrame } from "./util.js";
import { useWebcam } from "./webcam.js";

export function Amplify() {
  const shouldUseTestVideo = false;
  const webcam = useWebcam({
    enabled: !shouldUseTestVideo,
    preference: "BRIO",
    // preference: "FaceTime",
  });
  const video = useMemo(() => {
    if (shouldUseTestVideo) {
      const video = document.createElement("video");
      video.autoplay = true;
      video.src = "/train-cut.webm";
      video.volume = 0;
      video.loop = true;
      video.play();
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
      if (video.readyState >= 2) {
        console.log("gonna run run");
        if (!demo) {
          console.log("Creating new Demo instance");
          var s = Math.min(640 / video.videoWidth, 480 / video.videoHeight);
          var w = Math.floor((video.videoWidth * s) >> 3) << 3,
            h = Math.floor((video.videoHeight * s) >> 3) << 3;
          const demo = new Demo(w, h);
          setDemo(new Demo(w, h));
          console.log(s);
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
  }, [video, isMirrored, demo]);

  return (
    <div className="flex">
      <DomNode node={video} apply={(node) => (node.style.width = "100%")} />
      {demo && (
        <DomNode
          node={demo.canvas}
          apply={(node) => (node.style.width = "100%")}
        />
      )}
    </div>
  );
}
