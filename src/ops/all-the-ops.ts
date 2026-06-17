import _ from "lodash";
import { assert } from "../assert.js";
import { AnyOp } from "../ops-core.js";

export type OpWithMetadata = AnyOp & {
  groupName: string;
  groupNum: number;
  opNum: number;
};

export let ops: OpWithMetadata[] = _.map(
  import.meta.glob(["./*/*.tsx", "./*/*.js"], { eager: true }),
  (mod, filePath) => {
    const op = (mod as any).default as AnyOp;
    // pattern: ./10-Sources/010-cam.tsx
    const match = filePath.match(/^\.\/(\d*)-(.*)\/(\d*)-(.*)\.(tsx|js)$/);
    if (!match) {
      throw new Error(`Unexpected file path format: ${filePath}`);
    }
    const [_, groupNum, groupName, opNum, opId] = match;

    assert(
      op.id === opId,
      `Operation id "${op.id}" does not match file name "${opId}.tsx"`,
    );

    return { ...op, groupName, groupNum: +groupNum, opNum: +opNum };
  },
);

if (import.meta.hot) {
  const d = import.meta.hot.data;
  const isReload = !!d.ops;
  d.ops ??= [];
  d.ops.length = 0;
  d.ops.push(...ops);
  ops = d.ops;
  if (isReload) window.dispatchEvent(new CustomEvent("ops-hmr"));
  import.meta.hot.accept();
}
