const files = import.meta.glob(
  "../node_modules/lygia/**/*.glsl",
  { query: "?raw", import: "default", eager: true }, // → each key = file path, each value = file text
);

const LYGIA_SRC: Record<string, string> = {};
for (const [fullPath, code] of Object.entries(files)) {
  // “/node_modules/lygia/color/space.glsl” → “lygia/color/space.glsl”
  const short = fullPath.slice(fullPath.indexOf("/lygia/") + 1);
  LYGIA_SRC[short] = code as string;
}

function join(a: string, b: string): string {
  if (b.startsWith("/")) return b.slice(1);
  const stack = a.split("/").slice(0, -1);
  for (const part of b.split("/")) {
    if (part === "..") stack.pop();
    else if (part !== "." && part !== "") stack.push(part);
  }
  return stack.join("/");
}

const includePattern = /^\s*#include\s+["<]([^">]+)[">]/gm;

export function expandLygiaInPlace(
  src: string,
  file: string | null = null,
  seen = new Set<string>(),
): string {
  return src.replace(includePattern, (_, inc) => {
    const path = file ? join(file, inc) : inc;
    if (seen.has(path)) return "";
    const body = LYGIA_SRC[path];
    if (!body) {
      console.warn("Actual includes are", Object.keys(LYGIA_SRC));
      throw new Error(`Missing include: ${path}`);
    }
    seen.add(path);
    return expandLygiaInPlace(body, path, seen); // recurse
  });
}

export function expandLygia(src: string): string {
  const seen = new Set<string>();
  const extractedIncludes: string[] = [];
  const expanded = src.replace(includePattern, (_, inc) => {
    if (seen.has(inc)) return "";
    const body = LYGIA_SRC[inc];
    if (!body) {
      console.warn("Actual includes are", Object.keys(LYGIA_SRC));
      throw new Error(`Missing include: ${inc}`);
    }
    seen.add(inc);
    extractedIncludes.push(expandLygiaInPlace(body, inc, seen));
    return "";
  });

  if (extractedIncludes.length === 0) return expanded;

  // find "// lygia-includes" comment
  const idx = expanded.indexOf("// lygia-includes");
  if (idx === -1) {
    throw new Error("No // lygia-includes comment found in shader source");
  }
  // replace it with the extracted includes
  return (
    expanded.slice(0, idx) +
    extractedIncludes.join("\n") +
    "\n" +
    expanded.slice(idx + "// lygia-includes".length)
  );
}
