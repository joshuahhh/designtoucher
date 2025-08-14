import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "h-flip" as const,
  fragBody: `
    vec2 uvFlip = vec2(1.0 - uv.x, uv.y);
    gl_FragColor = texture2D(tex1, uvFlip);
  `,
  inputKeys: ["tex1"],
  RenderTop: ({ Handle }) => {
    return (
      <Sentence>
        Horizontally flip <Handle key="tex1" handleKey="tex1" />
      </Sentence>
    );
  },
});
