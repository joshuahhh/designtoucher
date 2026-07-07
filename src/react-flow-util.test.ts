// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import {
  parseClipboard,
  shouldIgnoreClipboardEvent,
} from "./react-flow-util.js";

// ── parseClipboard ──────────────────────────────────────────────────

describe("parseClipboard", () => {
  const validPayload = {
    marker: "designtoucher/clipboard@1",
    nodes: [
      { id: "n1", type: "operation", position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [{ id: "e1", source: "n1", target: "n2" }],
  };

  test("parses a valid payload", () => {
    const result = parseClipboard(JSON.stringify(validPayload));
    expect(result).toEqual(validPayload);
  });

  test("returns null for empty string", () => {
    expect(parseClipboard("")).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(parseClipboard("{not json")).toBeNull();
  });

  test("returns null for wrong marker", () => {
    expect(
      parseClipboard(JSON.stringify({ ...validPayload, marker: "nope" })),
    ).toBeNull();
  });

  test("returns null for missing marker", () => {
    const { marker: _, ...noMarker } = validPayload;
    expect(parseClipboard(JSON.stringify(noMarker))).toBeNull();
  });

  test("returns null when nodes is not an array", () => {
    expect(
      parseClipboard(
        JSON.stringify({ ...validPayload, nodes: "not an array" }),
      ),
    ).toBeNull();
  });

  test("defaults edges to empty array when missing", () => {
    const { edges: _, ...noEdges } = validPayload;
    const result = parseClipboard(JSON.stringify(noEdges));
    expect(result).not.toBeNull();
    expect(result!.edges).toEqual([]);
  });

  test("defaults edges to empty array when not an array", () => {
    const result = parseClipboard(
      JSON.stringify({ ...validPayload, edges: "nope" }),
    );
    expect(result).not.toBeNull();
    expect(result!.edges).toEqual([]);
  });

  test("returns null for plain text", () => {
    expect(parseClipboard("hello world")).toBeNull();
  });
});

// ── shouldIgnoreClipboardEvent ──────────────────────────────────────

describe("shouldIgnoreClipboardEvent", () => {
  test("returns false for null target", () => {
    expect(shouldIgnoreClipboardEvent(null)).toBe(false);
  });

  test("returns false for a non-HTMLElement target", () => {
    expect(shouldIgnoreClipboardEvent({} as EventTarget)).toBe(false);
  });

  test("returns true for INPUT elements", () => {
    const el = document.createElement("input");
    expect(shouldIgnoreClipboardEvent(el)).toBe(true);
  });

  test("returns true for TEXTAREA elements", () => {
    const el = document.createElement("textarea");
    expect(shouldIgnoreClipboardEvent(el)).toBe(true);
  });

  test("returns true for SELECT elements", () => {
    const el = document.createElement("select");
    expect(shouldIgnoreClipboardEvent(el)).toBe(true);
  });

  // jsdom doesn't implement isContentEditable, so we skip this case
  test.skip("returns true for contentEditable elements", () => {
    const el = document.createElement("div");
    el.contentEditable = "true";
    expect(shouldIgnoreClipboardEvent(el)).toBe(true);
  });

  test("returns true for .nocopypaste elements", () => {
    const el = document.createElement("div");
    el.classList.add("nocopypaste");
    expect(shouldIgnoreClipboardEvent(el)).toBe(true);
  });

  test("returns false for a regular div", () => {
    const el = document.createElement("div");
    expect(shouldIgnoreClipboardEvent(el)).toBe(false);
  });
});
