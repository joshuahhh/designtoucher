import _ from "lodash";
import { assert } from "../assert.js";
import { AnyOp } from "../ops-core.js";

export const ops = _.map(
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

export let opsInGroups: [
  string,
  (AnyOp & { groupNum: number; opNum: number })[],
][] = [];
for (const op of ops) {
  const group = opsInGroups.find(([name]) => name === op.groupName);
  if (group) {
    group[1].push(op);
  } else {
    opsInGroups.push([op.groupName, [op]]);
  }
}
for (const group of opsInGroups) {
  group[1] = _.sortBy(group[1], (op) => op.opNum);
}
opsInGroups = _.sortBy(opsInGroups, ([, [firstOp]]) => firstOp.groupNum);
