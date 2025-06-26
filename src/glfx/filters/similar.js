import { Shader } from "../core/shader";
import { simpleShader } from "./common";

export default function similar(targetColor, distance) {
  window.gl.similar =
    window.gl.similar ||
    new Shader(
      null,
      `
        uniform sampler2D texture;
        uniform vec2 texSize;
        varying vec2 texCoord;

        uniform vec3 targetColor;
        uniform float distance;

        void main() {
            vec4 color = texture2D(texture, texCoord);

            if (abs(color.r - targetColor.r) < distance &&
                abs(color.g - targetColor.g) < distance &&
                abs(color.b - targetColor.b) < distance) {
                gl_FragColor = vec4(1., 1., 1., 1.);
            } else {
                gl_FragColor = vec4(0., 0., 0., 1.);
            }
        }
    `,
    );

  simpleShader.call(this, window.gl.similar, {
    targetColor: targetColor,
    distance: distance,
  });

  return this;
}

// gl.swirl = gl.swirl || warpShader('\
// uniform float radius;\
// uniform float angle;\
// uniform vec2 center;\
// ', '\
// coord -= center;\
// float distance = length(coord);\
// if (distance < radius) {\
//     float percent = (radius - distance) / radius;\
//     float theta = percent * percent * angle;\
//     float s = sin(theta);\
//     float c = cos(theta);\
//     coord = vec2(\
//         coord.x * c - coord.y * s,\
//         coord.x * s + coord.y * c\
//     );\
// }\
// coord += center;\
// ');

// simpleShader.call(this, gl.swirl, {
// radius: radius,
// center: [centerX, centerY],
// angle: angle,
// texSize: [this.width, this.height]
// });
