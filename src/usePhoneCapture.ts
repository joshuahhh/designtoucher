import Peer from "peerjs";
import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";

import { Flow } from "./Flow.js";
import { AnyOpId } from "./ops-core.js";
import { OpNode } from "./ops-flow.js";
import { idbSet } from "./useIDB.js";

const getId = () => `n${Math.random().toString(16).slice(2)}`;

export type PhoneCaptureState = {
  peerId: string | null;
  captureCount: number;
};

export function usePhoneCapture(
  setFlow: Dispatch<SetStateAction<Flow>>,
): PhoneCaptureState {
  const [peerId, setPeerId] = useState<string | null>(null);
  const [captureCount, setCaptureCount] = useState(0);
  const setFlowRef = useRef(setFlow);
  setFlowRef.current = setFlow;

  useEffect(() => {
    const peer = new Peer();

    peer.on("open", (id) => {
      setPeerId(id);
    });

    peer.on("connection", (conn) => {
      conn.on("data", async (data: unknown) => {
        const msg = data as {
          type: string;
          mediaKind: "image" | "video";
          fileName: string;
          blob: Blob;
        };
        if (msg.type !== "capture") return;

        const blob =
          msg.blob instanceof Blob
            ? msg.blob
            : new Blob([msg.blob], {
                type: msg.mediaKind === "image" ? "image/jpeg" : "video/mp4",
              });

        const key = crypto.randomUUID();
        await idbSet(`media:${key}`, blob);

        const newNode: OpNode = {
          id: getId(),
          type: "operation",
          position: {
            x: Math.random() * 400 - 200,
            y: Math.random() * 400 - 200,
          },
          data: {
            opId: "saved-video" as AnyOpId,
            params: {
              blobKey: key,
              fileName: msg.fileName,
              mediaKind: msg.mediaKind,
            },
          },
        };

        setFlowRef.current((f) => ({
          ...f,
          nodes: [...f.nodes, newNode],
        }));

        setCaptureCount((c) => c + 1);
        conn.send({ type: "ack" });
      });
    });

    peer.on("error", (e) => {
      console.error("Capture peer error:", e);
    });

    return () => {
      peer.destroy();
    };
  }, []);

  return { peerId, captureCount };
}
