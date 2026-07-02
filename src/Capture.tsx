import Peer from "peerjs";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

function useDeviceRotation() {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    let currentRotation = 0;
    let listening = false;

    const handler = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x === null || g.y === null) return;

      const { x, y } = g;
      const absX = Math.abs(x);
      const absY = Math.abs(y);

      if (absX < 3 && absY < 3) return;

      let newRotation: number;
      if (absX > absY * 1.3) {
        newRotation = x > 0 ? 90 : -90;
      } else if (absY > absX * 1.3) {
        newRotation = y > 0 ? 0 : 180;
      } else {
        return;
      }

      if (newRotation !== currentRotation) {
        console.log("Device rotation:", newRotation, "gravity:", {
          x: x.toFixed(2),
          y: y.toFixed(2),
        });
        currentRotation = newRotation;
        setRotation(newRotation);
      }
    };

    const startListening = () => {
      if (listening) return;
      listening = true;
      window.addEventListener("devicemotion", handler);
    };

    if (
      typeof DeviceMotionEvent === "undefined" ||
      typeof (DeviceMotionEvent as any).requestPermission !== "function"
    ) {
      startListening();
    }

    const onInteraction = async () => {
      document.removeEventListener("click", onInteraction);
      document.removeEventListener("touchend", onInteraction);
      if (listening) return;
      if (
        typeof DeviceMotionEvent !== "undefined" &&
        typeof (DeviceMotionEvent as any).requestPermission === "function"
      ) {
        try {
          const permission = await (
            DeviceMotionEvent as any
          ).requestPermission();
          if (permission === "granted") startListening();
        } catch (e) {
          console.log("Motion permission error:", e);
        }
      }
    };

    document.addEventListener("click", onInteraction);
    document.addEventListener("touchend", onInteraction);

    return () => {
      window.removeEventListener("devicemotion", handler);
      document.removeEventListener("click", onInteraction);
      document.removeEventListener("touchend", onInteraction);
    };
  }, []);

  return rotation;
}

export const Capture = () => {
  const { id } = useParams();
  const [status, setStatus] = useState<
    "connecting" | "ready" | "sending" | "received" | "error"
  >("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const connRef = useRef<import("peerjs").DataConnection | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  );
  const rotation = useDeviceRotation();

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

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 4096 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      } catch (e) {
        console.error("Camera error:", e);
        setStatus("error");
        setErrorMsg("Could not access camera.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [facingMode]);

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

  const statusContent = (
    <>
      {status === "connecting" && (
        <div style={{ fontSize: "18px" }}>Connecting...</div>
      )}
      {status === "error" && (
        <div style={{ fontSize: "16px", color: "#f87171" }}>{errorMsg}</div>
      )}
      {status === "received" && (
        <div style={{ fontSize: "18px", color: "#4ade80" }}>Received!</div>
      )}
      {status === "sending" && (
        <div style={{ fontSize: "18px" }}>Sending...</div>
      )}
      {status === "ready" && (
        <>
          <button
            onClick={flipCamera}
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.6)",
              background: "rgba(255,255,255,0.15)",
              color: "#fff",
              fontSize: "20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Flip camera"
          >
            ⟲
          </button>
          <button
            onClick={capturePhoto}
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              border: "4px solid #fff",
              background: "rgba(255,255,255,0.15)",
              cursor: "pointer",
              transition: "background 0.15s",
            }}
            title="Take photo"
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "#fff",
                margin: "auto",
              }}
            />
          </button>
          <div style={{ width: 48, height: 48 }} />
        </>
      )}
    </>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        color: "#fff",
        touchAction: "none",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          position: "absolute",
          inset: 0,
          transform: facingMode === "user" ? "scaleX(-1)" : undefined,
        }}
      />

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "24px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "24px",
          background: "linear-gradient(transparent, rgba(0,0,0,0.6))",
        }}
      >
        {statusContent}
      </div>
    </div>
  );
};
