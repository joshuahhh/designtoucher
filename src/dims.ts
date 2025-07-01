export default function dims(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
) {
  if (source instanceof HTMLVideoElement) {
    return [source.videoWidth, source.videoHeight];
  } else {
    return [source.width, source.height];
  }
}
