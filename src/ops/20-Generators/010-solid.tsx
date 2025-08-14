import { Popover } from "@radix-ui/themes";
import clsx from "clsx";
import { RgbaColorPicker } from "react-colorful";
import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "solid",
  initParams() {
    return { r: 1, g: 0, b: 0, a: 1 };
  },
  fragBody: `
    gl_FragColor = vec4(r, g, b, a);
  `,
  RenderTop: (props) => {
    const buttonClassName = clsx(
      "border border-gray-300 rounded-md p-1 shadow-sm hover:bg-gray-50 transition-colors",
    );

    const r = props.params.r as number;
    const g = props.params.g as number;
    const b = props.params.b as number;
    const a = props.params.a as number;

    return (
      <Sentence>
        Solid color:{" "}
        <Popover.Root>
          <Popover.Trigger>
            <button
              className={clsx(
                "inline-flex items-center gap-1",
                buttonClassName,
              )}
            >
              Select
            </button>
          </Popover.Trigger>
          <Popover.Content side="top" size="1">
            <RgbaColorPicker
              color={{ r: r * 255, g: g * 255, b: b * 255, a: a }}
              onChange={(color) => {
                props.paramsUP.$set({
                  r: color.r / 255,
                  g: color.g / 255,
                  b: color.b / 255,
                  a: color.a,
                });
              }}
            />
          </Popover.Content>
        </Popover.Root>
      </Sentence>
    );
  },
});
