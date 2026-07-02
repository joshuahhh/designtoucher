import { clsx } from "clsx";
import { QRCodeSVG } from "qrcode.react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  FaBars,
  FaCamera,
  FaDownload,
  FaFile,
  FaLink,
  FaUpload,
  FaXmark,
} from "react-icons/fa6";

import { Flow } from "./Flow.js";
import { initialFlow } from "./initialFlow.js";
import { BASE_URL } from "./lib.js";
import { makeShareUrl } from "./share.js";
import { PhoneCaptureState } from "./usePhoneCapture.js";

type Toast = {
  message: string;
  type: "success" | "warning" | "error";
};

export const Menu = memo(function Menu({
  flow,
  loadFlow,
  phoneCapture,
}: {
  flow: Flow;
  loadFlow: (flow: Flow) => void;
  phoneCapture: PhoneCaptureState;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [isOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleShare = useCallback(() => {
    const { url, length } = makeShareUrl(flow);
    navigator.clipboard.writeText(url).then(
      () => {
        if (length > 15000) {
          setToast({
            message: `Link copied, but it's ${(length / 1000).toFixed(1)}k characters. Most platforms will break URLs this long. Use "Save File" to share reliably.`,
            type: "error",
          });
        } else if (length > 4000) {
          setToast({
            message: `Link copied! (${(length / 1000).toFixed(1)}k chars — some platforms may truncate long URLs)`,
            type: "warning",
          });
        } else {
          setToast({ message: "Link copied to clipboard!", type: "success" });
        }
      },
      () => {
        setToast({
          message: "Failed to copy link to clipboard.",
          type: "error",
        });
      },
    );
    setIsOpen(false);
  }, [flow]);

  const handleSave = useCallback(() => {
    const flowData = JSON.stringify(flow, null, 2);
    const blob = new Blob([flowData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "design-toucher.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setIsOpen(false);
  }, [flow]);

  const handleLoad = useCallback(() => {
    fileInputRef.current?.click();
    setIsOpen(false);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (
            window.confirm(
              "Load this file? This replaces your current project.",
            )
          ) {
            loadFlow(data);
          }
        } catch {
          setToast({ message: "Failed to read file.", type: "error" });
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [loadFlow],
  );

  const handleNew = useCallback(() => {
    if (window.confirm("Start a new project? This clears the current one.")) {
      loadFlow(initialFlow);
    }
    setIsOpen(false);
  }, [loadFlow]);

  const handlePhoneCamera = useCallback(() => {
    setCaptureOpen(true);
    setIsOpen(false);
  }, []);

  const itemClass =
    "w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded transition-colors flex items-center gap-2";

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-white border border-gray-300 rounded-md p-2 shadow-sm hover:bg-gray-50 transition-colors"
        title="Menu"
      >
        <FaBars className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-48 z-50">
          <button onClick={handlePhoneCamera} className={itemClass}>
            <FaCamera className="w-3.5 h-3.5 shrink-0" /> Phone Camera
          </button>
          <div className="border-t border-gray-200 my-1" />
          <button onClick={handleShare} className={itemClass}>
            <FaLink className="w-3.5 h-3.5 shrink-0" /> Share Link
          </button>
          <button onClick={handleSave} className={itemClass}>
            <FaDownload className="w-3.5 h-3.5 shrink-0" /> Save File
          </button>
          <button onClick={handleLoad} className={itemClass}>
            <FaUpload className="w-3.5 h-3.5 shrink-0" /> Open File
          </button>
          <div className="border-t border-gray-200 my-1" />
          <button onClick={handleNew} className={itemClass}>
            <FaFile className="w-3.5 h-3.5 shrink-0" /> New
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />

      {toast && (
        <div
          className={clsx(
            "absolute top-full left-0 mt-2 px-3 py-2 rounded-lg shadow-lg text-sm w-64 pointer-events-auto",
            toast.type === "success" &&
              "bg-green-100 text-green-800 border border-green-300",
            toast.type === "warning" &&
              "bg-yellow-100 text-yellow-800 border border-yellow-300",
            toast.type === "error" &&
              "bg-red-100 text-red-800 border border-red-300",
          )}
        >
          {toast.message}
          <button
            onClick={() => setToast(null)}
            className="ml-2 opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {captureOpen && (
        <PhoneCapturePanel
          phoneCapture={phoneCapture}
          onClose={() => setCaptureOpen(false)}
        />
      )}
    </div>
  );
});

function PhoneCapturePanel({
  phoneCapture,
  onClose,
}: {
  phoneCapture: PhoneCaptureState;
  onClose: () => void;
}) {
  const captureUrl = phoneCapture.peerId
    ? `${BASE_URL}/capture/${phoneCapture.peerId}`
    : null;

  return (
    <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-xl p-4 w-72 z-50 pointer-events-auto">
      <div className="flex justify-between items-center mb-3">
        <span className="font-medium text-sm">Phone Camera</span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <FaXmark className="w-3.5 h-3.5 text-gray-500" />
        </button>
      </div>

      {captureUrl ? (
        <>
          <div className="flex justify-center mb-3 bg-white p-2 rounded border border-gray-100">
            <QRCodeSVG value={captureUrl} size={200} />
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Scan with your phone to capture photos. They'll appear as nodes in
            the canvas.
          </p>
          {phoneCapture.captureCount > 0 && (
            <p className="text-xs text-green-600">
              {phoneCapture.captureCount} photo
              {phoneCapture.captureCount !== 1 ? "s" : ""} received
            </p>
          )}
        </>
      ) : (
        <div className="text-sm text-gray-500 text-center py-4">
          Connecting...
        </div>
      )}
    </div>
  );
}
