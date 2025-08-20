import { FaArrowsLeftRight, FaArrowsUpDown } from "react-icons/fa6";
import { Sentence, SentenceButton } from "../../ops-core.js";
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
        Flip <props.InputHandle key="tex1" inputKey="tex1" />{" "}
        <SentenceButton onClick={() => props.paramsUP.horizontal.$((v) => !v)}>
          {props.params.horizontal ? (
            <FaArrowsLeftRight className="inline-block w-2 h-2" />
          ) : (
            <FaArrowsUpDown className="inline-block w-2 h-2" />
          )}
        </SentenceButton>
      </Sentence>
    );
  },
  searchHints: ["AKA: mirror, reflect."],
});
