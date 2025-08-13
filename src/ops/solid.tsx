import { Sentence } from "../ops-core.js";
import { defineFragOp } from "../ops-frag.js";

export default defineFragOp({
  id: "solid" as const,
  fragBody: `
    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); // solid red color
  `,
  RenderTop: () => {
    return <Sentence>Solid color (red for now)</Sentence>;
  },
});
