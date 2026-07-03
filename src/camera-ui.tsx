import {
  CSSProperties,
  ReactNode,
  RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { FaLock, FaLockOpen } from "react-icons/fa6";

export type FacingMode = "environment" | "user";

const errString = (e: unknown) =>
  e instanceof Error ? `${e.name}: ${e.message}` : String(e);

const needsMotionPermission = () =>
  typeof DeviceMotionEvent !== "undefined" &&
  typeof (DeviceMotionEvent as any).requestPermission === "function";

// Shared gravity → rotation logic. Calls onRotation with 0 / 90 / -90 / 180
// whenever the reading changes (including the first stable reading).
function makeGravityHandler(onRotation: (rotation: number) => void) {
  let currentRotation: number | null = null;
  return (e: DeviceMotionEvent) => {
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
      onRotation(newRotation);
    }
  };
}

// Physical device rotation (0, 90, -90, 180) from the accelerometer,
// followed continuously. Works even when the phone has rotation lock on,
// unlike screen.orientation. On iOS the motion-sensor permission prompt
// appears on the first tap anywhere on the page.
export function useDeviceRotation() {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const handler = makeGravityHandler(setRotation);

    if (!needsMotionPermission()) {
      window.addEventListener("devicemotion", handler);
      return () => {
        window.removeEventListener("devicemotion", handler);
      };
    }

    let listening = false;
    const onInteraction = async () => {
      document.removeEventListener("click", onInteraction);
      document.removeEventListener("touchend", onInteraction);
      if (listening) return;
      try {
        const permission = await (DeviceMotionEvent as any).requestPermission();
        if (permission === "granted") {
          listening = true;
          window.addEventListener("devicemotion", handler);
        }
      } catch (e) {
        console.log("Motion permission error:", e);
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

// Lockable variant: starts locked at rotation 0. Unlocking (a user gesture —
// iOS shows the motion permission prompt there) follows the device; locking
// again freezes the rotation at its current value rather than resetting it.
export function useLockableRotation() {
  const [locked, setLocked] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [motionError, setMotionError] = useState<string | null>(null);

  const toggleLock = async () => {
    if (!locked) {
      // freeze at the current rotation
      setLocked(true);
      return;
    }
    if (needsMotionPermission()) {
      try {
        const permission = await (DeviceMotionEvent as any).requestPermission();
        if (permission !== "granted") {
          setMotionError("Motion permission denied; can't detect rotation.");
          return;
        }
      } catch (e) {
        console.error("Motion permission error:", e);
        setMotionError(`Motion permission error: ${errString(e)}`);
        return;
      }
    }
    setMotionError(null);
    setLocked(false);
  };

  useEffect(() => {
    if (locked) return;
    const handler = makeGravityHandler(setRotation);
    window.addEventListener("devicemotion", handler);
    return () => {
      window.removeEventListener("devicemotion", handler);
    };
  }, [locked]);

  return { rotation, locked, toggleLock, motionError };
}

export function useCameraStream(
  facingMode: FacingMode,
  { idealWidth }: { idealWidth?: number } = {},
) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  // e.g. exact-facingMode attempt failed and we fell back to browser's pick
  const [warning, setWarning] = useState<string | null>(null);
  // chosen camera + live track state, for on-screen debugging
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    const trackCleanups: (() => void)[] = [];

    setError(null);
    setWarning(null);
    setInfo(null);

    const widthConstraint = idealWidth ? { width: { ideal: idealWidth } } : {};

    (async () => {
      let s: MediaStream;
      try {
        try {
          // exact facingMode: a bare string is only a soft preference the
          // browser may override in favor of other constraints
          s = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { exact: facingMode }, ...widthConstraint },
            audio: false,
          });
        } catch (e1) {
          console.error(`exact facingMode ${facingMode} failed:`, e1);
          if (!cancelled) {
            setWarning(
              `exact ${facingMode} failed (${errString(e1)}); falling back`,
            );
          }
          // no camera facing that way (e.g. laptop) — let the browser pick
          s = await navigator.mediaDevices.getUserMedia({
            video: { facingMode, ...widthConstraint },
            audio: false,
          });
        }
      } catch (e2) {
        console.error("Camera error:", e2);
        if (!cancelled) setError(`Camera failed: ${errString(e2)}`);
        return;
      }

      console.log("Camera settings:", s.getVideoTracks()[0]?.getSettings());
      if (cancelled) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;

      const track = s.getVideoTracks()[0];
      if (track) {
        const updateInfo = () => {
          const st = track.getSettings();
          const flags = [
            track.muted && "MUTED",
            track.readyState === "ended" && "ENDED",
          ]
            .filter(Boolean)
            .join(" ");
          setInfo(
            `${st.width}×${st.height} ${track.label}${flags ? ` [${flags}]` : ""}`,
          );
        };
        updateInfo();
        for (const event of ["mute", "unmute", "ended"]) {
          track.addEventListener(event, updateInfo);
          trackCleanups.push(() =>
            track.removeEventListener(event, updateInfo),
          );
        }
      }

      setStream(s);
    })();

    return () => {
      cancelled = true;
      trackCleanups.forEach((f) => f());
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode, idealWidth]);

  return { stream, error, warning, info };
}

// Full-screen viewfinder with a control bar along the bottom.
export function CameraShell({
  stream,
  mirrored,
  videoRef: externalVideoRef,
  controls,
  debugLines = [],
}: {
  stream: MediaStream | null;
  mirrored?: boolean;
  videoRef?: RefObject<HTMLVideoElement>;
  controls: ReactNode;
  // Extra diagnostic lines shown in the top-left overlay (null entries skipped)
  debugLines?: (string | null)[];
}) {
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalVideoRef ?? internalVideoRef;
  const [playError, setPlayError] = useState<string | null>(null);
  const [pageErrors, setPageErrors] = useState<string[]>([]);

  // Phone screens have no console — surface uncaught errors on screen
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      setPageErrors((p) => [...p.slice(-4), `error: ${e.message}`]);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      setPageErrors((p) => [...p.slice(-4), `unhandled: ${String(e.reason)}`]);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    setPlayError(null);
    video.play().catch((e) => {
      console.error("video.play failed:", e);
      setPlayError(
        `video.play failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`,
      );
    });
  }, [stream, videoRef]);

  const allDebugLines = [...debugLines, playError, ...pageErrors].filter(
    (l): l is string => !!l,
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
          transform: mirrored ? "scaleX(-1)" : undefined,
        }}
      />

      {allDebugLines.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            right: 8,
            fontSize: "11px",
            fontFamily: "monospace",
            color: "#fff",
            textShadow: "0 1px 3px rgba(0,0,0,0.9)",
            opacity: 0.85,
            pointerEvents: "none",
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
          }}
        >
          {allDebugLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

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
        {controls}
      </div>
    </div>
  );
}

export function StatusText({
  color,
  children,
}: {
  color?: string;
  children: ReactNode;
}) {
  return <div style={{ fontSize: "18px", color }}>{children}</div>;
}

export function FlipCameraButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
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
  );
}

// Invisible box matching FlipCameraButton's size, for centering the shutter.
export function ControlSpacer() {
  return <div style={{ width: 48, height: 48 }} />;
}

// Toggle for following device rotation. Shows a padlock: locked (default)
// means the app ignores how the phone is held; unlocked means captured
// photos / streamed video rotate to match.
export function RotationLockButton({
  locked,
  onClick,
}: {
  locked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 48,
        height: 48,
        borderRadius: "50%",
        border: locked
          ? "2px solid rgba(255,255,255,0.6)"
          : "2px solid #4ade80",
        background: "rgba(255,255,255,0.15)",
        color: locked ? "#fff" : "#4ade80",
        fontSize: "18px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      title={
        locked
          ? "Rotation locked — tap to follow how you hold the phone"
          : "Following rotation — tap to lock"
      }
    >
      {locked ? <FaLock /> : <FaLockOpen />}
    </button>
  );
}

export function ShutterButton({
  onClick,
  style,
}: {
  onClick: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 72,
        height: 72,
        borderRadius: "50%",
        border: "4px solid #fff",
        background: "rgba(255,255,255,0.15)",
        cursor: "pointer",
        transition: "background 0.15s",
        ...style,
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
  );
}
