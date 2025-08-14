import { Popover } from "@radix-ui/themes";
import clsx from "clsx";
import Peer from "peerjs";
import { QRCodeSVG } from "qrcode.react";
import { LuCopy, LuQrCode } from "react-icons/lu";
import { CopyButton } from "../CopyButton.js";
import { newTex, Tex } from "../mygl.js";
import { defineOp, Sentence } from "../ops-core.js";
import { stopStream, WebcamStream } from "../webcam.js";

export default defineOp({
  id: "remote-cam" as const,
  initRuntime(ctx) {
    return {
      webcamStream: null as WebcamStream | null,
      video: document.createElement("video"),
      id: null as string | null,
      out: null as Tex | null,
    };
  },
  initWithRuntime({ ctx, runtime }) {
    const peer = new Peer();

    peer.on("open", (id) => {
      runtime.id = id;
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

    peer.on("error", (e) => console.error("Peer error:", e));
  },
  run({ runtime, inputs, paramValues, ctx }) {
    const { gl } = ctx;

    if (runtime.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    if (!runtime.out) {
      console.log(
        "Creating new texture for remote cam",
        runtime.video.videoWidth,
        runtime.video.videoHeight,
      );
      runtime.out = newTex(
        ctx.gl,
        runtime.video.videoWidth,
        runtime.video.videoHeight,
      );
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
    if (runtime.webcamStream) {
      stopStream(runtime.webcamStream);
      runtime.webcamStream = null;
    }
  },
  RenderTop: (props) => {
    const id = props.runtime?.id;
    if (!id) {
      return (
        <Sentence>
          Use remote camera <span className="italic">[loading...]</span>
        </Sentence>
      );
    }

    const senderUrl = window.location.href + "#sender/" + id;
    const buttonClassName = clsx(
      "border border-gray-300 rounded-md p-1 shadow-sm hover:bg-gray-50 transition-colors",
    );

    return (
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
            <Popover.Content side="top" size="1">
              <QRCodeSVG value={senderUrl} />
            </Popover.Content>
          </Popover.Root>
        </div>
      </Sentence>
    );
  },
});
