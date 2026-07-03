import { Popover } from "@radix-ui/themes";
import clsx from "clsx";
import Peer from "peerjs";
import { QRCodeSVG } from "qrcode.react";
import { LuCopy, LuQrCode } from "react-icons/lu";
import { CopyButton } from "../../CopyButton.js";
import { BASE_URL } from "../../lib.js";
import { ensureTexSize, newTex, Tex } from "../../mygl.js";
import { defineOp, MyPopoverContent, Sentence } from "../../ops-core.js";
import { stopStream, WebcamStream } from "../../webcam.js";

const RETRY_DELAY_MS = 3000;
const MAX_ID_RETRIES = 5;

type RemoteCamRuntime = {
  webcamStream: WebcamStream | null;
  video: HTMLVideoElement;
  id: string | null;
  out: Tex | null;
  peer: Peer | null;
  desiredId: string | null;
  idAttempts: number;
  retryTimeout: number | null;
  destroyed: boolean;
};

function makePeer(runtime: RemoteCamRuntime, notify: () => void) {
  // After too many failures, give up on the saved id and take a random one
  const peer =
    runtime.desiredId && runtime.idAttempts <= MAX_ID_RETRIES
      ? new Peer(runtime.desiredId)
      : new Peer();
  runtime.peer = peer;

  peer.on("open", (id) => {
    runtime.id = id;
    notify();
  });

  // Answer incoming media calls; we don't send any tracks
  peer.on("call", (call) => {
    console.log("got a call!", call);
    call.answer(); // receive-only
    call.on("stream", (stream) => {
      console.log("got a stream!", stream);
      runtime.video.srcObject = stream;
      runtime.video.play();
    });
    call.on("error", (e) => console.error("Call error:", e));
    call.on("close", () => console.log("Call closed"));
  });

  peer.on("error", (e) => {
    console.error("Peer error:", e);
    if ((e as { type?: string }).type === "unavailable-id") {
      // Saved id still held elsewhere — a stale session after a fast
      // reload, or another open copy of this project. Retry, eventually
      // falling back to a random id.
      runtime.idAttempts++;
      runtime.retryTimeout = window.setTimeout(() => {
        if (runtime.destroyed) return;
        makePeer(runtime, notify);
      }, RETRY_DELAY_MS);
    }
  });
}

export default defineOp({
  id: "remote-cam",
  initParams: () => ({ peerId: crypto.randomUUID() }),
  initRuntime(): RemoteCamRuntime {
    return {
      webcamStream: null,
      video: document.createElement("video"),
      id: null,
      out: null,
      peer: null,
      desiredId: null,
      idAttempts: 0,
      retryTimeout: null,
      destroyed: false,
    };
  },
  run({ runtime, params, ctx, notify }) {
    if (!runtime.peer) {
      // Peer creation happens here rather than initRuntime because
      // initRuntime doesn't receive params
      runtime.desiredId = (params.peerId as string | undefined) ?? null;
      makePeer(runtime, notify);
    }

    const { gl } = ctx;

    if (runtime.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    const vw = runtime.video.videoWidth;
    const vh = runtime.video.videoHeight;
    if (!runtime.out) {
      console.log("Creating new texture for remote cam", vw, vh);
      runtime.out = newTex(ctx.gl, vw, vh);
    } else if (runtime.out.width !== vw || runtime.out.height !== vh) {
      // WebRTC changes stream resolution on the fly (e.g. ramping up as
      // bandwidth allows); texSubImage2D silently fails on a size mismatch
      console.log(
        "Remote cam resolution changed",
        `${runtime.out.width}x${runtime.out.height}`,
        "->",
        `${vw}x${vh}`,
      );
      ensureTexSize(runtime.out, vw, vh);
      notify();
    }

    gl.bindTexture(gl.TEXTURE_2D, runtime.out.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    // console.log("BEFORE texSubImage2D");
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      runtime.video,
    );
  },
  destroy({ runtime }) {
    runtime.destroyed = true;
    if (runtime.retryTimeout !== null) {
      clearTimeout(runtime.retryTimeout);
      runtime.retryTimeout = null;
    }
    // Release the id so this node (or a reloaded copy) can reclaim it
    runtime.peer?.destroy();
    runtime.peer = null;
    if (runtime.webcamStream) {
      stopStream(runtime.webcamStream);
      runtime.webcamStream = null;
    }
  },
  Render(props) {
    const id = props.runtime?.id;
    if (!id) {
      return (
        <>
          <Sentence>
            Use remote camera <span className="italic">[loading...]</span>
          </Sentence>
          <props.OutputHandle outputKey="out" />
        </>
      );
    }

    const senderUrl = BASE_URL + "/sender/" + id;
    const buttonClassName = clsx(
      "border border-gray-300 rounded-md p-1 shadow-sm hover:bg-gray-50 transition-colors",
    );

    return (
      <>
        <Sentence>
          <div>Use remote camera @ {id.slice(0, 8)}</div>
          <div className="flex gap-2">
            <CopyButton text={senderUrl} className={buttonClassName}>
              <LuCopy className="inline-block" />
              Copy URL
            </CopyButton>
            <Popover.Root>
              <Popover.Trigger>
                <button
                  className={clsx(
                    "inline-flex items-center gap-1",
                    buttonClassName,
                  )}
                >
                  <LuQrCode className="inline-block" />
                  Show URL QR
                </button>
              </Popover.Trigger>
              <MyPopoverContent>
                <QRCodeSVG value={senderUrl} />
              </MyPopoverContent>
            </Popover.Root>
          </div>
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["Great for connecting to a phone camera."],
});
