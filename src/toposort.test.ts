import { describe, expect, test } from "vitest";
import {
  Edge,
  getTransitiveDownstream,
  getTransitiveUpstream,
  toposort,
  toposortFromEdges,
} from "./toposort.js";

// ── getTransitiveUpstream / getTransitiveDownstream ──────────────────

const rfEdge = (source: string, target: string) => ({
  id: `${source}->${target}`,
  source,
  target,
});

describe("getTransitiveUpstream", () => {
  test("returns empty set for node with no upstream", () => {
    const edges = [rfEdge("a", "b"), rfEdge("b", "c")];
    expect(getTransitiveUpstream("a", edges)).toEqual(new Set());
  });

  test("finds direct upstream", () => {
    const edges = [rfEdge("a", "b")];
    expect(getTransitiveUpstream("b", edges)).toEqual(new Set(["a"]));
  });

  test("finds transitive upstream through a chain", () => {
    const edges = [rfEdge("a", "b"), rfEdge("b", "c"), rfEdge("c", "d")];
    expect(getTransitiveUpstream("d", edges)).toEqual(new Set(["a", "b", "c"]));
  });

  test("finds upstream through a diamond", () => {
    //   a
    //  / \
    // b   c
    //  \ /
    //   d
    const edges = [
      rfEdge("a", "b"),
      rfEdge("a", "c"),
      rfEdge("b", "d"),
      rfEdge("c", "d"),
    ];
    expect(getTransitiveUpstream("d", edges)).toEqual(new Set(["a", "b", "c"]));
  });

  test("in a cycle, the start node is reachable from itself", () => {
    const edges = [rfEdge("a", "b"), rfEdge("b", "a")];
    const result = getTransitiveUpstream("a", edges);
    expect(result).toEqual(new Set(["a", "b"]));
  });

  test("handles disconnected nodes", () => {
    const edges = [rfEdge("a", "b"), rfEdge("x", "y")];
    expect(getTransitiveUpstream("b", edges)).toEqual(new Set(["a"]));
  });
});

describe("getTransitiveDownstream", () => {
  test("returns empty set for node with no downstream", () => {
    const edges = [rfEdge("a", "b")];
    expect(getTransitiveDownstream("b", edges)).toEqual(new Set());
  });

  test("finds direct downstream", () => {
    const edges = [rfEdge("a", "b")];
    expect(getTransitiveDownstream("a", edges)).toEqual(new Set(["b"]));
  });

  test("finds transitive downstream through a chain", () => {
    const edges = [rfEdge("a", "b"), rfEdge("b", "c"), rfEdge("c", "d")];
    expect(getTransitiveDownstream("a", edges)).toEqual(
      new Set(["b", "c", "d"]),
    );
  });

  test("handles fan-out", () => {
    const edges = [rfEdge("a", "b"), rfEdge("a", "c"), rfEdge("a", "d")];
    expect(getTransitiveDownstream("a", edges)).toEqual(
      new Set(["b", "c", "d"]),
    );
  });
});

// ── toposortFromEdges ───────────────────────────────────────────────

describe("toposortFromEdges", () => {
  test("sorts a simple chain", () => {
    const nodes = ["a", "b", "c"];
    const edges: Edge[] = [
      ["a", "b"],
      ["b", "c"],
    ];
    const { sorted, cyclic } = toposortFromEdges(nodes, edges);
    expect(cyclic.size).toBe(0);
    expect(sorted.indexOf("c")).toBeLessThan(sorted.indexOf("b"));
    expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("a"));
  });

  test("includes isolated nodes", () => {
    const { sorted, cyclic } = toposortFromEdges(["a", "b", "c"], []);
    expect(cyclic.size).toBe(0);
    expect(sorted.sort()).toEqual(["a", "b", "c"]);
  });

  test("detects a simple cycle", () => {
    const { cyclic } = toposortFromEdges(
      ["a", "b"],
      [
        ["a", "b"],
        ["b", "a"],
      ],
    );
    expect(cyclic).toContain("a");
    expect(cyclic).toContain("b");
  });

  test("marks downstream-of-cycle nodes as cyclic too", () => {
    // c -> a -> b -> a (cycle), so a, b, c are all cyclic
    const { cyclic } = toposortFromEdges(
      ["a", "b", "c"],
      [
        ["a", "b"],
        ["b", "a"],
        ["c", "a"],
      ],
    );
    expect(cyclic).toContain("a");
    expect(cyclic).toContain("b");
    expect(cyclic).toContain("c");
  });

  test("non-cyclic nodes that don't depend on a cycle stay sorted", () => {
    // d -> e (no cycle), a <-> b (cycle)
    const { sorted, cyclic } = toposortFromEdges(
      ["a", "b", "d", "e"],
      [
        ["a", "b"],
        ["b", "a"],
        ["d", "e"],
      ],
    );
    expect(cyclic).toContain("a");
    expect(cyclic).toContain("b");
    expect(sorted).toContain("d");
    expect(sorted).toContain("e");
    expect(sorted.indexOf("e")).toBeLessThan(sorted.indexOf("d"));
  });

  test("throws on unknown node in edges", () => {
    expect(() => toposortFromEdges(["a"], [["a", "z"]])).toThrow(
      /Unknown node/,
    );
  });
});

// ── toposort (with outgoingEdges map) ───────────────────────────────

describe("toposort (direct)", () => {
  test("diamond dependency", () => {
    //   a
    //  / \
    // b   c
    //  \ /
    //   d
    // a depends on b, c; b, c depend on d
    const { sorted, cyclic } = toposort(["a", "b", "c", "d"], {
      a: new Set(["b", "c"]),
      b: new Set(["d"]),
      c: new Set(["d"]),
    });
    expect(cyclic.size).toBe(0);
    expect(sorted.indexOf("d")).toBeLessThan(sorted.indexOf("b"));
    expect(sorted.indexOf("d")).toBeLessThan(sorted.indexOf("c"));
    expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("a"));
    expect(sorted.indexOf("c")).toBeLessThan(sorted.indexOf("a"));
  });
});
