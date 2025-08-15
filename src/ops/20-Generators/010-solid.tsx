import { Inset, Popover } from "@radix-ui/themes";
import clsx from "clsx";
import { useContext } from "react";
import { ChromePicker } from "react-color";
import { OmniCanvasContext } from "../../OmniCanvas.js";
import { MyPopoverContent, Sentence } from "../../ops-core.js";
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

    const { r, g, b, a } = props.params;

    const { overlayDiv } = useContext(OmniCanvasContext);

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
          <MyPopoverContent>
            <Inset>
              <ChromePicker
                color={{ r: r * 255, g: g * 255, b: b * 255, a }}
                onChange={({ rgb }) => {
                  props.paramsUP.$set({
                    r: rgb.r / 255,
                    g: rgb.g / 255,
                    b: rgb.b / 255,
                    a: rgb.a ?? 1,
                  });
                }}
              />
            </Inset>
          </MyPopoverContent>
        </Popover.Root>
      </Sentence>
    );
  },
});
