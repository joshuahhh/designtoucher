import { MediaConnection, Peer } from "peerjs";
import { RefObject, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CameraShell,
  FacingMode,
  FlipCameraButton,
  RotationLockButton,
  StatusText,
  useCameraStream,
  useLockableRotation,
} from "./camera-ui.js";

// On rotation-locked phones the camera keeps capturing in the browser's
// fixed orientation even when the phone is held sideways. When the
// accelerometer says we're rotated, re-render frames through a rotated
// canvas and stream that track instead of the raw camera track.
function useRotatedTrack(
  stream: MediaStream | null,
  videoRef: RefObject<HTMLVideoElement>,
  rotation: number,
): MediaStreamTrack | null {
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);

  useEffect(() => {
    const raw = stream?.getVideoTracks()[0] ?? null;
    const video = videoRef.current;
    if (!stream || !raw || rotation === 0 || !video) {
      setTrack(raw);
      return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw && vh) {
        const [cw, ch] = rotation === 180 ? [vw, vh] : [vh, vw];
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }
        ctx.save();
        ctx.translate(cw / 2, ch / 2);
        ctx.rotate((-rotation * Math.PI) / 180);
        ctx.drawImage(video, -vw / 2, -vh / 2);
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const canvasStream = canvas.captureStream(30);
    const canvasTrack = canvasStream.getVideoTracks()[0];
    setTrack(canvasTrack);

    return () => {
      cancelAnimationFrame(raf);
      canvasTrack.stop();
    };
  }, [stream, rotation, videoRef]);

  return track;
}

export const Sender = () => {
  const { id } = useParams();
  const [status, setStatus] = useState<"connecting" | "streaming" | "error">(
    "connecting",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const {
    stream,
    error: cameraError,
    warning: cameraWarning,
    info: cameraInfo,
  } = useCameraStream(facingMode);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { rotation, locked, toggleLock, motionError } = useLockableRotation();
  const trackToSend = useRotatedTrack(stream, videoRef, rotation);
  const peerRef = useRef<Peer | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  streamRef.current = stream;

  // Establish the call once, when the first stream is available
  useEffect(() => {
    if (!id || !stream) return;
    if (peerRef.current) return;

    const peer = new Peer();
    peerRef.current = peer;

    peer.on("error", (e) => {
      console.error("Peer error:", e);
      setStatus("error");
      setErrorMsg("Connection failed. Try scanning the QR code again.");
    });

    peer.on("open", () => {
      if (!streamRef.current) return;
      const call = peer.call(id, streamRef.current);
      callRef.current = call;
      setStatus("streaming");
      call.on("error", (e) => {
        console.error("Call error:", e);
        setStatus("error");
        setErrorMsg("Connection lost.");
      });
      call.on("close", () => {
        callRef.current = null;
        setStatus("error");
        setErrorMsg("Connection closed.");
      });
    });
  }, [id, stream]);

  // Keep the outgoing video track in sync (camera flips, rotation changes)
  useEffect(() => {
    const call = callRef.current;
    if (!call || !trackToSend) return;
    const sender = call.peerConnection
      ?.getSenders()
      .find((s) => s.track?.kind === "video");
    sender?.replaceTrack(trackToSend);
  }, [trackToSend, status]);

  useEffect(() => {
    return () => {
      peerRef.current?.destroy();
    };
  }, []);

  const flipCamera = () => {
    setFacingMode((m) => (m === "environment" ? "user" : "environment"));
  };

  const controls = cameraError ? (
    <StatusText color="#f87171">{cameraError}</StatusText>
  ) : status === "connecting" ? (
    <StatusText>Connecting...</StatusText>
  ) : status === "error" ? (
    <StatusText color="#f87171">{errorMsg}</StatusText>
  ) : (
    <>
      <FlipCameraButton onClick={flipCamera} />
      <StatusText color="#4ade80">Streaming</StatusText>
      <RotationLockButton locked={locked} onClick={toggleLock} />
    </>
  );

  return (
    <CameraShell
      stream={stream}
      mirrored={facingMode === "user"}
      videoRef={videoRef}
      controls={controls}
      debugLines={[
        cameraInfo,
        cameraWarning,
        motionError,
        rotation !== 0 ? `sending rotated ${rotation}°` : null,
      ]}
    />
  );
};
