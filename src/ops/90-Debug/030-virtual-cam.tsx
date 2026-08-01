import { Popover, Switch } from "@radix-ui/themes";
import { useState } from "react";
import { LuCircleHelp, LuCopy, LuCopyCheck, LuSettings } from "react-icons/lu";
import { ShaderProgram } from "../../mygl.js";
import {
  defineOp,
  MyPopoverContent,
  Sentence,
  SentenceButton,
  SentenceParamSelect,
} from "../../ops-core.js";

const DEFAULT_URL = "ws://localhost:8765/ws";
const RECONNECT_INTERVAL = 2000;

function wsConnect(runtime: any, url: string, notify: () => void) {
  if (runtime.ws) return;
  runtime.error = null;
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    runtime.ws = ws;
    runtime.connected = true;
    runtime.configuredSize = null;
    runtime.framesSent = 0;
    runtime.framesSkipped = 0;
    runtime.lastConnectAttempt = 0;
    runtime.lastStatsTime = performance.now();
    runtime.lastStatsFrames = 0;
    runtime.fps = 0;
    notify();
  };
  ws.onmessage = () => {};
  ws.onerror = () => {
    runtime.error = "connection failed";
    runtime.connected = false;
    runtime.ws = null;
    runtime.lastConnectAttempt = performance.now();
    notify();
  };
  ws.onclose = () => {
    runtime.connected = false;
    runtime.ws = null;
    runtime.lastConnectAttempt = performance.now();
    notify();
  };
}

export default defineOp({
  id: "virtual-cam",
  inputKeys: ["in"],
  initParams: () => ({
    enabled: true,
    smooth: "smooth" as "off" | "smooth",
    scale: "0.5" as "1" | "0.75" | "0.5" | "0.25",
    flipH: true,
    url: DEFAULT_URL,
  }),
  initRuntime(ctx) {
    const { gl } = ctx;

    const flipProgram = new ShaderProgram(
      gl,
      `
        attribute vec2 position;
        varying vec2 uv;
        void main() {
          uv = 0.5 * (position + 1.0);
          uv.y = 1.0 - uv.y;
          gl_Position = vec4(position, 0.0, 1.0);
        }
      `,
      `
        precision mediump float;
        uniform sampler2D tex1;
        uniform float flipH;
        varying vec2 uv;
        void main() {
          vec2 c = uv;
          if (flipH > 0.5) c.x = 1.0 - c.x;
          gl_FragColor = texture2D(tex1, c);
        }
      `,
    );

    const flipFb = gl.createFramebuffer()!;
    const flipTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, flipTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return {
      ws: null as WebSocket | null,
      connected: false,
      error: null as string | null,
      lastConnectAttempt: 0,
      connectedUrl: null as string | null,
      flipProgram,
      flipFb,
      flipTex,
      flipTexW: 0,
      flipTexH: 0,
      pixels: null as Uint8Array | null,
      configuredSize: null as { w: number; h: number } | null,
      framesSent: 0,
      framesSkipped: 0,
      lastStatsTime: 0,
      lastStatsFrames: 0,
      fps: 0,
    };
  },
  run({ runtime, inputs, params, ctx, notify }) {
    if (!params.enabled) {
      if (runtime.ws) {
        runtime.ws.close();
        runtime.ws = null;
        runtime.connected = false;
        notify();
      }
      return;
    }

    if (runtime.ws && runtime.connectedUrl !== params.url) {
      runtime.ws.close();
      runtime.ws = null;
      runtime.connected = false;
      runtime.connectedUrl = null;
    }

    if (
      !runtime.ws &&
      performance.now() - runtime.lastConnectAttempt > RECONNECT_INTERVAL
    ) {
      runtime.connectedUrl = params.url;
      wsConnect(runtime, params.url, notify);
    }

    const { gl } = ctx;
    const input = inputs.in;
    if (!input || !runtime.connected || !runtime.ws) return;

    const ws = runtime.ws;
    if (ws.readyState !== WebSocket.OPEN) return;

    const scale = parseFloat(params.scale);
    const w = Math.round(input.width * scale);
    const h = Math.round(input.height * scale);

    if (
      !runtime.configuredSize ||
      runtime.configuredSize.w !== w ||
      runtime.configuredSize.h !== h
    ) {
      ws.send(JSON.stringify({ width: w, height: h, fps: 30 }));
      runtime.configuredSize = { w, h };

      gl.bindTexture(gl.TEXTURE_2D, runtime.flipTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        w,
        h,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, runtime.flipFb);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        runtime.flipTex,
        0,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      runtime.flipTexW = w;
      runtime.flipTexH = h;
      runtime.pixels = new Uint8Array(w * h * 4);
      return;
    }

    runtime.flipProgram.run({
      targetFramebuffer: runtime.flipFb,
      viewport: [0, 0, w, h],
      uniforms: {
        tex1: ["sampler2D", input.texture],
        flipH: ["1f", params.flipH ? 1 : 0],
      },
      fullscreen: true,
    });

    const pixels = runtime.pixels!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, runtime.flipFb);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const maxBuffered =
      (params.smooth === "smooth" ? 3 : 1) * pixels.byteLength;
    if (ws.bufferedAmount < maxBuffered) {
      ws.send(pixels.buffer as ArrayBuffer);
      runtime.framesSent++;
    } else {
      runtime.framesSkipped++;
    }

    const now = performance.now();
    if (now - runtime.lastStatsTime > 1000) {
      runtime.fps =
        ((runtime.framesSent - runtime.lastStatsFrames) * 1000) /
        (now - runtime.lastStatsTime || 1);
      runtime.lastStatsTime = now;
      runtime.lastStatsFrames = runtime.framesSent;
    }
  },
  destroy({ runtime, ctx }) {
    if (runtime.ws) {
      runtime.ws.close();
    }
    const { gl } = ctx;
    gl.deleteProgram(runtime.flipProgram.program);
    gl.deleteFramebuffer(runtime.flipFb);
    gl.deleteTexture(runtime.flipTex);
  },
  Render(props) {
    const runtime = props.runtime;
    const enabled = props.params.enabled;
    const connected = runtime?.connected ?? false;
    const error = runtime?.error ?? null;
    const [copied, setCopied] = useState(false);

    return (
      <>
        <Sentence>
          Send <props.InputHandle inputKey="in" /> to virtual cam{" "}
          <Popover.Root>
            <Popover.Trigger>
              <SentenceButton>
                <LuSettings />
              </SentenceButton>
            </Popover.Trigger>
            <MyPopoverContent>
              <div className="flex flex-col gap-2 text-[11px] nodrag">
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">scale</span>
                  <SentenceParamSelect
                    value={props.params.scale}
                    valueUP={props.paramsUP.scale}
                    options={[
                      { value: "1", label: "1x" },
                      { value: "0.75", label: "3/4x" },
                      { value: "0.5", label: "1/2x" },
                      { value: "0.25", label: "1/4x" },
                    ]}
                  />
                  <span className="text-gray-500 ml-1">mode</span>
                  <SentenceParamSelect
                    value={props.params.smooth}
                    valueUP={props.paramsUP.smooth}
                    options={[
                      { value: "off", label: "low latency" },
                      { value: "smooth", label: "smooth" },
                    ]}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    size="1"
                    checked={props.params.flipH}
                    onCheckedChange={(v) => props.paramsUP.flipH.$set(v)}
                  />
                  <span className="text-gray-500">flip horizontally</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">url</span>
                  <input
                    className="nodrag flex-1 min-w-0 bg-gray-100 rounded px-1 py-0.5 text-gray-700 font-mono outline-none focus:ring-1 focus:ring-gray-300"
                    type="text"
                    value={props.params.url}
                    onChange={(e) => props.paramsUP.url.$set(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    spellCheck={false}
                  />
                </div>
              </div>
            </MyPopoverContent>
          </Popover.Root>
        </Sentence>
        <div className="flex items-center gap-1.5 px-1 text-[10px] text-gray-400 w-full">
          <Switch
            size="1"
            checked={enabled}
            onCheckedChange={(v) => props.paramsUP.enabled.$set(v)}
          />
          <span>
            {enabled
              ? connected
                ? `sending ${runtime?.fps.toFixed(0)} fps at ${runtime?.configuredSize ? `${runtime.configuredSize.w}×${runtime.configuredSize.h}` : "..."}`
                : error
                  ? "retrying..."
                  : "connecting..."
              : "off"}
          </span>
          <span className="flex-1" />
          {enabled && !connected && (
            <Popover.Root>
              <Popover.Trigger>
                <button className="text-gray-400 hover:text-gray-600">
                  <LuCircleHelp size={12} />
                </button>
              </Popover.Trigger>
              <MyPopoverContent>
                <div className="text-[11px] text-gray-700 max-w-[220px] nodrag flex flex-col gap-1.5">
                  <p>
                    You need OBS Virtual Camera installed and the relay server
                    running:
                  </p>
                  <button
                    className="flex items-center gap-1 bg-gray-100 rounded px-1.5 py-1 font-mono text-[10px] text-left hover:bg-gray-200 transition-colors"
                    onClick={() => {
                      navigator.clipboard.writeText("uvx ws2virtualcam");
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    <span className="flex-1">uvx ws2virtualcam</span>
                    {copied ? (
                      <LuCopyCheck size={11} className="text-green-600" />
                    ) : (
                      <LuCopy size={11} className="text-gray-400" />
                    )}
                  </button>
                </div>
              </MyPopoverContent>
            </Popover.Root>
          )}
        </div>
      </>
    );
  },
  searchHints: ["websocket", "virtual camera", "obs", "stream", "output"],
});
