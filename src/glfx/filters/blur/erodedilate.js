import { Shader } from "../../core/shader";
import { randomShaderFunc, simpleShader } from "../common";

export default function erodeDilate(radius, dilate) {
  window.gl.triangleBlur =
    window.gl.triangleBlur ||
    new Shader(
      null,
      `
        uniform sampler2D texture;
        uniform vec2 delta;
        varying vec2 texCoord;
        uniform float dilate;
        ${randomShaderFunc}
        void main() {
            gl_FragColor = texture2D(texture, texCoord);
            float total = 0.0;

            /* randomize the lookup values to hide the fixed number of samples */
            float offset = random(vec3(12.9898, 78.233, 151.7182), 0.0);

            for (float t = -30.0; t <= 30.0; t++) {
                float percent = (t + offset - 0.5) / 30.0;
                vec4 sample = texture2D(texture, texCoord + delta * percent);

                /* switch to pre-multiplied alpha to correctly blur transparent images */
                sample.rgb *= sample.a;

                gl_FragColor = dilate == 0. ? max(gl_FragColor, sample) : min(gl_FragColor, sample);
            }

            /* switch back from pre-multiplied alpha */
            gl_FragColor.rgb /= gl_FragColor.a + 0.00001;
        }
    `,
    );

  simpleShader.call(this, window.gl.triangleBlur, {
    delta: [radius / this.width, 0],
    dilate,
  });
  simpleShader.call(this, window.gl.triangleBlur, {
    delta: [0, radius / this.height],
    dilate,
  });

  return this;
}
