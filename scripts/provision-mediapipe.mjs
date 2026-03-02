import { cpSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";

// Copy WASM runtime from node_modules
const wasmSrc = "node_modules/@mediapipe/tasks-vision/wasm";
const wasmDst = "public/mediapipe";
if (existsSync(wasmSrc)) {
  mkdirSync(wasmDst, { recursive: true });
  cpSync(wasmSrc, wasmDst, { recursive: true });
  console.log("Copied MediaPipe WASM files to public/mediapipe/");
}

// Download segmentation model if not present
const modelDir = "public/models";
const modelFile = `${modelDir}/selfie_multiclass_256x256.tflite`;
if (!existsSync(modelFile)) {
  mkdirSync(modelDir, { recursive: true });
  const url =
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
  console.log("Downloading selfie_multiclass_256x256 model...");
  try {
    execSync(`curl -sL -o "${modelFile}" "${url}"`);
    console.log("Downloaded model to public/models/");
  } catch {
    console.warn("Failed to download model. You can download it manually from:");
    console.warn(url);
  }
}
