import { Flow } from "./Flow.js";

export type Example = {
  /** Stable id (the file path), used as a React key. */
  id: string;
  /** Display name, derived from the file name. */
  name: string;
  flow: Flow;
};

// Auto-discovered examples. Each file is a raw Flow (`{ nodes, edges, viewport }`),
// i.e. exactly what Cmd/Ctrl+S downloads. To add one: save your program, then drop
// the .json into src/examples/ (optionally with a NNN- prefix to control order).
const modules = import.meta.glob<Flow>("./examples/*.json", {
  eager: true,
  import: "default",
});

/** "./examples/010-feedback-trails.json" → "Feedback Trails" */
function prettyName(filePath: string): string {
  const base = filePath
    .split("/")
    .pop()!
    .replace(/\.json$/, "");
  const withoutNum = base.replace(/^\d+[-_]?/, "");
  return withoutNum
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const examples: Example[] = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([filePath, flow]) => ({
    id: filePath,
    name: prettyName(filePath),
    flow,
  }));
