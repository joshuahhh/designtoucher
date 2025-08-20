import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "hue-saturation",
  inputKeys: ["texture"],
  initParams() {
    return { hue: 0, saturation: 0 };
  },
  fragBody: `
    vec4 color = texture2D(texture, uv);

    /* hue adjustment, wolfram alpha: RotationTransform[angle, {1, 1, 1}][{x, y, z}] */
    float angle = hue * 3.14159265;
    float s = sin(angle), c = cos(angle);
    vec3 weights = (vec3(2.0 * c, -sqrt(3.0) * s - c, sqrt(3.0) * s - c) + 1.0) / 3.0;
    float len = length(color.rgb);
    color.rgb = vec3(
        dot(color.rgb, weights.xyz),
        dot(color.rgb, weights.zxy),
        dot(color.rgb, weights.yzx)
    );

    /* saturation adjustment */
    float average = (color.r + color.g + color.b) / 3.0;
    if (saturation > 0.0) {
        color.rgb += (average - color.rgb) * (1.0 - 1.0 / (1.001 - saturation));
    } else {
        color.rgb += (average - color.rgb) * (-saturation);
    }

    gl_FragColor = color;
  `,
  RenderTop: (props) => {
    return (
      <Sentence>
        <props.InputHandle inputKey="texture" /> Hue{" "}
        <SentenceParamNumber
          value={props.params.hue}
          valueUP={props.paramsUP.hue}
          min={-1}
          max={1}
          step={0.01}
        />
        , Saturation{" "}
        <SentenceParamNumber
          value={props.params.saturation}
          valueUP={props.paramsUP.saturation}
          min={-1}
          max={1}
          step={0.01}
        />
      </Sentence>
    );
  },
  searchHints: [
    "'Hue' changes colors around.",
    "'Saturation' makes colors more or less intense.",
    "You can make a grayscale (AKA greyscale, 'black and white') image by setting saturation to -1.",
  ],
});
