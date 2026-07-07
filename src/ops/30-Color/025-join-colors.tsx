import { Sentence } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "join-colors",
  inputKeys: ["texR", "texG", "texB"],
  fragBody: `
    vec3 texRColor = vec3(texture2D(texR, uv));
    vec3 texGColor = vec3(texture2D(texG, uv));
    vec3 texBColor = vec3(texture2D(texB, uv));
    gl_FragColor = vec4(
      max(texRColor.r, max(texRColor.g, texRColor.b)),
      max(texGColor.r, max(texGColor.g, texGColor.b)),
      max(texBColor.r, max(texBColor.g, texBColor.b)),
      1.0
    );
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Join colors from R: <props.InputHandle inputKey="texR" /> G:{" "}
          <props.InputHandle inputKey="texG" /> B:{" "}
          <props.InputHandle inputKey="texB" />{" "}
        </Sentence>
        <props.OutputHandle outputKey="out" />
      </>
    );
  },
  searchHints: ["AKA: posterize, quantize.", "Makes a cartoon effect."],
});
