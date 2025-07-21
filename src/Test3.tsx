import _ from "lodash";
import { useContext, useEffect, useMemo, useRef } from "react";
import { Framebuffer2D, Regl, Texture2D } from "regl";
import {
  OmniCanvasContext,
  OmniCanvasGuest,
  OmniCanvasHost,
} from "./OmniCanvas.js";
import { onWebcamFrame, useWebcam } from "./webcam.js";

export type Fbo = Framebuffer2D & {
  texture: Texture2D;
};

export function Fbo(regl: Regl): Fbo {
  const texture = regl.texture({ width: 640, height: 480 });
  const fbo = regl.framebuffer({ color: texture }) as Fbo;
  fbo.texture = texture;
  return fbo;
}

const boxes = _.range(300).map(() => ({
  width: 640 * Math.random(),
  height: 480 * Math.random(),
  h: Math.random(),
}));

export const Test3 = () => {
  return (
    <div className="min-w-full min-h-full p-10 prose box-border">
      <OmniCanvasHost>
        <Test3Inner />
      </OmniCanvasHost>
    </div>
  );
};

export const Test3Inner = () => {
  const { gl } = useContext(OmniCanvasContext);

  const webcam = useWebcam({
    width: 1920,
    preference: "FaceTime",
  });

  const webcamTextureRef = useRef<WebGLTexture | null>(null);

  useEffect(() => {
    const stream = webcam.stream;

    if (!stream) {
      return;
    }

    const cancel = onWebcamFrame(stream, () => {
      // update texture
      let webcamTexture = webcamTextureRef.current;
      if (!webcamTexture) {
        console.log("initing webcam texture", stream.width, stream.height);
        webcamTexture = newTexture(gl, stream.width, stream.height);
      } else {
        // console.log("updating webcam texture");
        webcamTexture.subimage({
          data: stream.video,
          flipY: true,
        });
      }
    });
    return () => {
      console.log(
        "Stopping video frame processing; we expect a onVideoFrame cancellation",
      );
      cancel();
    };
  }, [regl, webcam.stream]);

  const command = useMemo(() => {
    return regl({
      frag: `
          precision mediump float;
          uniform sampler2D tex1;
          varying vec2 uv;
          void main() {
            gl_FragColor = texture2D(tex1, uv);
          }
        `,
      vert: `
          precision mediump float;
          attribute vec2 position;
          varying vec2 uv;
          void main() {
            uv = 0.5 * (position + 1.0);
            gl_Position = vec4(position, 0, 1);
          }
        `,
      attributes: {
        position: [-1, -1, 1, -1, -1, 1, 1, 1],
      },
      elements: [
        [0, 1, 2],
        [2, 1, 3],
      ],
      uniforms: {
        tex1: regl.prop<any, any>("tex1"),
      },
    });
  }, [regl]);

  const fbo = useMemo(() => {
    return Fbo(regl);
  }, [regl]);

  return (
    <>
      <button
        onClick={() => {
          if (webcamTextureRef.current) {
            fbo.use(() => {
              command({
                tex1: webcamTextureRef.current,
              });
            });
          }
        }}
        className="bg-blue-500 text-white p-2 rounded"
      >
        Render Webcam to FBO
      </button>
      {boxes.map((box, i) => (
        <OmniCanvasGuest
          key={i}
          command={() => {
            command({
              tex1: i % 2 === 0 ? fbo : webcamTextureRef.current,
            });
          }}
          className="border border-black inline-block"
          style={box}
        />
      ))}
    </>
  );
};
