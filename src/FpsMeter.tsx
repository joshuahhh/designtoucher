import { useEffect, useRef, useState } from "react";
import { useKeyBindings } from "./keyboard.js";

const STORAGE_KEY = "fpsMeterVisible";

const BAR_COUNT = 90;
const MAX_MS = 50;
const BAR_W = 2;
const BAR_GAP = 1;
const H = 32;

function useFpsMeterVisible() {
  const [visible, setVisible] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true",
  );
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(visible));
  }, [visible]);
  return [visible, setVisible] as const;
}

function FpsMeterCanvas() {
  const frameTimes = useRef<number[]>([]);
  const lastTimeRef = useRef(performance.now());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const medianLabelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let id: number;
    const loop = () => {
      const now = performance.now();
      const dt = now - lastTimeRef.current;
      lastTimeRef.current = now;

      const buf = frameTimes.current;
      buf.push(dt);
      if (buf.length > BAR_COUNT) buf.shift();

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d")!;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const guideY = h * (1 - 16.67 / MAX_MS);
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, guideY);
        ctx.lineTo(w, guideY);
        ctx.stroke();

        for (let i = 0; i < buf.length; i++) {
          const ms = buf[i];
          const barH = Math.min(ms / MAX_MS, 1) * h;
          const x = i * (BAR_W + BAR_GAP);
          const color =
            ms > 20 ? "#ef4444" : ms > 16.67 ? "#f59e0b" : "#22c55e";
          ctx.fillStyle = color;
          ctx.fillRect(x, h - barH, BAR_W, barH);
        }

        if (buf.length > 0) {
          const sorted = [...buf].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          const median =
            sorted.length % 2
              ? sorted[mid]
              : (sorted[mid - 1] + sorted[mid]) / 2;
          if (medianLabelRef.current) {
            medianLabelRef.current.textContent = `${Math.round(median)}ms`;
          }
        }
      }

      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  const totalW = BAR_COUNT * (BAR_W + BAR_GAP) - BAR_GAP;

  return (
    <div className="fixed bottom-2 right-2 bg-white/90 border border-gray-200 rounded-lg p-2 shadow-sm z-50 select-none pointer-events-none">
      <div className="flex items-center gap-2">
        <canvas ref={canvasRef} style={{ width: totalW, height: H }} />
        <span className="text-xs font-mono text-slate-400">{MAX_MS}ms</span>
      </div>
      <span className="text-xs font-mono text-slate-400">
        P50 <span ref={medianLabelRef} />
      </span>
    </div>
  );
}

export function FpsMeter() {
  const [visible, setVisible] = useFpsMeterVisible();

  useKeyBindings([
    {
      combo: "c+s+p",
      action: () => setVisible((v) => !v),
    },
  ]);

  if (!visible) return null;
  return <FpsMeterCanvas />;
}
