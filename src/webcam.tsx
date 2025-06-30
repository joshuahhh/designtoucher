import { ChangeEvent, useEffect, useState } from "react";
import { useRefForCallback } from "./useRefForCallback.js";

type Webcam = {
  stream: WebcamStream | null;

  deviceId: string | null;
  devices: MediaDeviceInfo[];
  setDeviceId: (deviceId: string | null) => void;
};

type WebcamStream = {
  video: HTMLVideoElement;
  width: number;
  height: number;
};

async function startStream(deviceId: string): Promise<WebcamStream> {
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;

  const constraints: MediaStreamConstraints = {
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  video.play();

  // wait for metadata to be loaded so we can get video size
  await new Promise<void>((resolve) => {
    video.onloadeddata = () => {
      resolve();
    };
  });

  return {
    video,
    width: video.videoWidth,
    height: video.videoHeight,
  };
}

function stopStream(stream: WebcamStream) {
  const { video } = stream;
  if (video.srcObject instanceof MediaStream) {
    for (const track of video.srcObject.getTracks()) {
      track.stop();
    }
  }
  if (video) {
    video.pause();
    video.srcObject = null;
  }
}

export const useWebcam = ({
  enabled,
  preference,
}: {
  enabled?: boolean;
  preference?: string;
} = {}): Webcam => {
  enabled = enabled ?? true;
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [stream, setStream] = useState<WebcamStream | null>(null);
  const streamRef = useRefForCallback(stream);

  // not used reactively
  const preferenceRef = useRefForCallback(preference);

  useEffect(() => {
    // enumerate cameras

    (async () => {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const cams = allDevices.filter((d) => d.kind === "videoinput");
      setDevices(cams);
      const preference = preferenceRef.current;
      const preferredCamera =
        (preference && cams.find((cam) => cam.label.includes(preference))) ||
        cams[0];
      if (preferredCamera) {
        setDeviceId(preferredCamera.deviceId);
      }
    })();
  }, [deviceId, preferenceRef]);

  useEffect(() => {
    // update stream when deviceId changes

    if (streamRef.current) {
      stopStream(streamRef.current);
    }

    if (deviceId && enabled) {
      startStream(deviceId).then((stream) => {
        setStream(stream);
      });
    } else {
      setStream(null);
    }
  }, [deviceId, enabled, streamRef]);

  return {
    stream,

    devices,
    deviceId,
    setDeviceId,
  };
};

export const WebcamSelect = ({
  webcam,
  className,
}: {
  webcam: Webcam;
  className?: string;
}) => {
  const { deviceId, devices, setDeviceId } = webcam;

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setDeviceId(e.target.value);
  };

  return (
    <select
      className={className}
      value={deviceId ?? ""}
      onChange={handleChange}
    >
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || "Unnamed camera"}
        </option>
      ))}
    </select>
  );
};
