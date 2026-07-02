import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";

import { Flow } from "./Flow.js";

function stripFlowForSerialization(flow: Flow) {
  return {
    nodes: flow.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
      ...(n.origin ? { origin: n.origin } : {}),
    })),
    edges: flow.edges
      .filter((e) => !e.data?.provisional)
      .map(({ id, source, sourceHandle, target, targetHandle }) => ({
        id,
        source,
        sourceHandle,
        target,
        targetHandle,
      })),
    viewport: flow.viewport,
  };
}

export function serializeFlow(flow: Flow): string {
  const clean = stripFlowForSerialization(flow);
  return compressToEncodedURIComponent(JSON.stringify(clean));
}

export function deserializeFlow(encoded: string): Flow {
  const json = decompressFromEncodedURIComponent(encoded);
  if (!json) throw new Error("Failed to decompress flow data");
  return JSON.parse(json);
}

export function makeShareUrl(flow: Flow): { url: string; length: number } {
  const encoded = serializeFlow(flow);
  const base = window.location.href.replace(/#.*$/, "");
  const url = `${base}#/?project=${encoded}`;
  return { url, length: url.length };
}

/**
 * Read the `project` param from the URL hash without using URLSearchParams
 * (which decodes `+` as space, corrupting lz-string output).
 */
export function getProjectFromURL(): Flow | undefined {
  const hash = window.location.hash;
  const match = hash.match(/[?&]project=([^&]*)/);
  if (!match) return undefined;
  try {
    return deserializeFlow(match[1]);
  } catch (e) {
    console.error("Failed to load project from URL", e);
    return undefined;
  }
}

export function clearProjectFromURL() {
  const hash = window.location.hash;
  const cleaned = hash.replace(/([?&])project=[^&]*(&?)/, (_, prefix, after) =>
    after ? prefix : "",
  );
  const finalHash = cleaned === "#/?" ? "#/" : cleaned;
  window.history.replaceState(null, "", window.location.pathname + finalHash);
}
