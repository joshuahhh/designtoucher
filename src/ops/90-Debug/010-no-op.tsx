import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "no-op",
  inputKeys: ["tex1"],
  fragBody: `
    gl_FragColor = texture2D(tex1, uv);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          No-op on <props.InputHandle key="tex1" inputKey="tex1" /> (via shader)
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
});
