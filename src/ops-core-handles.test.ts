import { describe, expect, test } from "vitest";
import {
  isParamHandleId,
  makeInputHandleId,
  makeOutputHandleId,
  makeParamHandleId,
  parseInputHandleId,
  parseOutputHandleId,
  parseParamHandleId,
} from "./ops-core.js";

// ── makeInputHandleId / parseInputHandleId ──────────────────────────

describe("input handle IDs", () => {
  test("round-trips through make/parse", () => {
    const id = makeInputHandleId("node-1", "tex");
    const parsed = parseInputHandleId(id);
    expect(parsed).toEqual({ nodeId: "node-1", key: "tex" });
  });

  test("handles keys with special characters", () => {
    const id = makeInputHandleId("n", "a-b_c");
    expect(parseInputHandleId(id)).toEqual({ nodeId: "n", key: "a-b_c" });
  });

  test("parseInputHandleId throws on invalid format", () => {
    expect(() => parseInputHandleId("bad")).toThrow(/Invalid input handleId/);
  });

  test("parseInputHandleId throws on output handle format", () => {
    expect(() => parseInputHandleId("n:output:key")).toThrow(
      /Invalid input handleId/,
    );
  });
});

// ── makeOutputHandleId / parseOutputHandleId ────────────────────────

describe("output handle IDs", () => {
  test("round-trips through make/parse", () => {
    const id = makeOutputHandleId("node-2", "out");
    const parsed = parseOutputHandleId(id);
    expect(parsed).toEqual({ nodeId: "node-2", key: "out" });
  });

  test("parseOutputHandleId throws on invalid format", () => {
    expect(() => parseOutputHandleId("bad")).toThrow(/Invalid output handleId/);
  });

  test("parseOutputHandleId throws on input handle format", () => {
    expect(() => parseOutputHandleId("n:input:key")).toThrow(
      /Invalid output handleId/,
    );
  });
});

// ── makeParamHandleId / parseParamHandleId / isParamHandleId ────────

describe("param handle IDs", () => {
  test("round-trips through make/parse", () => {
    const id = makeParamHandleId("node-3", "brightness");
    const parsed = parseParamHandleId(id);
    expect(parsed).toEqual({ nodeId: "node-3", key: "brightness" });
  });

  test("parseParamHandleId throws on invalid format", () => {
    expect(() => parseParamHandleId("bad")).toThrow(/Invalid param handleId/);
  });

  test("isParamHandleId returns true for param handles", () => {
    expect(isParamHandleId(makeParamHandleId("n", "k"))).toBe(true);
  });

  test("isParamHandleId returns false for input handles", () => {
    expect(isParamHandleId(makeInputHandleId("n", "k"))).toBe(false);
  });

  test("isParamHandleId returns false for output handles", () => {
    expect(isParamHandleId(makeOutputHandleId("n", "k"))).toBe(false);
  });

  test("isParamHandleId returns false for null/undefined", () => {
    expect(isParamHandleId(null)).toBe(false);
    expect(isParamHandleId(undefined)).toBe(false);
  });
});
