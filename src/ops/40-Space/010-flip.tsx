import { FaArrowsLeftRight, FaArrowsUpDown } from "react-icons/fa6";
import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "flip",
  inputKeys: ["tex1"],
  initParams: () => ({
    horizontal: true,
  }),
  // TODO: booleans end up as floats in the shader
  fragBody: `
    vec2 uvFlip = horizontal == 1.0 ? vec2(1.0 - uv.x, uv.y) : vec2(uv.x, 1.0 - uv.y);
    gl_FragColor = texture2D(tex1, uvFlip);
  `,
  RenderTop: (props) => {
    return (
      <Sentence>
        Flip <props.Handle key="tex1" handleKey="tex1" />{" "}
        <button onClick={() => props.paramsUP.horizontal.$((v) => !v)}>
          {props.params.horizontal ? (
            <FaArrowsLeftRight className="inline-block" />
          ) : (
            <FaArrowsUpDown className="inline-block" />
          )}
        </button>
      </Sentence>
    );
  },
});
