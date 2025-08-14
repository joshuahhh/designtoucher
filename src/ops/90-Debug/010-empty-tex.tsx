import { defineOp, Sentence } from "../../ops-core.js";

export default defineOp({
  id: "empty-tex",
  initRuntime: (ctx) => ({ out: ctx.emptyTex }),
  RenderTop: (props) => <Sentence>ctx.emptyTex</Sentence>,
});
