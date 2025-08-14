import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "no-op",
  inputKeys: ["tex1"],
  fragBody: `
    gl_FragColor = texture2D(tex1, uv);
  `,
  RenderTop: (props) => {
    return (
      <Sentence>
        No-op on <props.Handle key="tex1" handleKey="tex1" /> (via shader)
      </Sentence>
    );
  },
});
