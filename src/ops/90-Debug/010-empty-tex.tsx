import { defineOp, Sentence } from "../../ops-core.js";

export default defineOp({
  id: "empty-tex",
  initRuntime: (ctx) => ({ out: ctx.emptyTex }),
  Render: (props) => (
    <>
      <Sentence>ctx.emptyTex</Sentence>
      <props.OutputHandle outputKey="out" />
    </>
  ),
});
