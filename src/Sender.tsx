import { Peer } from "peerjs";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export const Sender = () => {
  const params = useParams();
  const id = params.id;

  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);

  // init video
  useEffect(() => {
    if (!video) return;

    (async () => {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      video.srcObject = camStream;
      video.play?.();
      setCamStream(camStream);
    })();
  }, [video]);

  // init peer connection
  useEffect(() => {
    if (!camStream || !id) return;

    console.log("Connecting to peer with id:", id);

    const peer = new Peer();

    peer.on("error", (e) => console.error("Peer error:", e));
    peer.on("open", () => {
      const call = peer.call(id, camStream);
      call.on("error", (e) => console.error("Call error:", e));
      call.on("close", () => console.log("Call closed"));
      console.log("Call established with id:", id);
    });
  }, [id, camStream]);

  return (
    <div>
      <div>sender {id}</div>
      <video
        ref={setVideo}
        autoPlay
        muted
        playsInline
        style={{ width: "40vw", maxWidth: "320px", background: "#000" }}
      ></video>
    </div>
  );
};
