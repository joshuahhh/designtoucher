import Peer from "peerjs";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CameraShell,
  ControlSpacer,
  FacingMode,
  FlipCameraButton,
  ShutterButton,
  StatusText,
  useCameraStream,
  useDeviceRotation,
} from "./camera-ui.js";

export const Capture = () => {
  const { id } = useParams();
  const [status, setStatus] = useState<
    "connecting" | "ready" | "sending" | "received" | "error"
  >("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const connRef = useRef<import("peerjs").DataConnection | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const rotation = useDeviceRotation();
  const {
    stream,
    error: cameraError,
    warning: cameraWarning,
    info: cameraInfo,
  } = useCameraStream(facingMode, {
    idealWidth: 4096,
  });

  useEffect(() => {
    if (!id) return;

    const peer = new Peer();

    peer.on("error", (e) => {
      console.error("Peer error:", e);
      setStatus("error");
      setErrorMsg("Connection failed. Try scanning the QR code again.");
    });

    peer.on("open", () => {
      const conn = peer.connect(id);
      conn.on("open", () => {
        connRef.current = conn;
        setStatus("ready");
      });
      conn.on("data", (data: unknown) => {
        const msg = data as { type: string };
        if (msg.type === "ack") {
          setStatus("received");
          setTimeout(() => setStatus("ready"), 1500);
        }
      });
      conn.on("error", (e) => {
        console.error("Connection error:", e);
        setStatus("error");
        setErrorMsg("Connection lost.");
      });
      conn.on("close", () => {
        connRef.current = null;
        setStatus("error");
        setErrorMsg("Connection closed.");
      });
    });

    return () => {
      peer.destroy();
    };
  }, [id]);

  const capturePhoto = async () => {
    const video = videoRef.current;
    const conn = connRef.current;
    if (!video || !conn) return;

    setStatus("sending");

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    if (rotation === 90 || rotation === -90) {
      canvas.width = vh;
      canvas.height = vw;
    } else {
      canvas.width = vw;
      canvas.height = vh;
    }

    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (rotation !== 0) {
      ctx.rotate((-rotation * Math.PI) / 180);
    }
    ctx.drawImage(video, -vw / 2, -vh / 2);

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92),
    );

    conn.send({
      type: "capture",
      mediaKind: "image",
      fileName: `photo-${Date.now()}.jpg`,
      blob,
    });
  };

  const flipCamera = () => {
    setFacingMode((m) => (m === "environment" ? "user" : "environment"));
  };

  const controls = cameraError ? (
    <StatusText color="#f87171">{cameraError}</StatusText>
  ) : status === "connecting" ? (
    <StatusText>Connecting...</StatusText>
  ) : status === "error" ? (
    <StatusText color="#f87171">{errorMsg}</StatusText>
  ) : status === "received" ? (
    <StatusText color="#4ade80">Received!</StatusText>
  ) : status === "sending" ? (
    <StatusText>Sending...</StatusText>
  ) : (
    <>
      <FlipCameraButton onClick={flipCamera} />
      <ShutterButton onClick={capturePhoto} />
      <ControlSpacer />
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
        rotation !== 0 ? `rotated ${rotation}°` : null,
      ]}
    />
  );
};
