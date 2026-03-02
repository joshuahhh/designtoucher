import { DraggableRenderer, scale, translate } from "dragology";
import { useEffect, useRef, useState } from "react";
import { UpdateProxy } from "update-proxy";
import { Sentence, SentenceParamNumber } from "../../ops-core.js";
import { defineFragOp } from "../../ops-frag.js";

export default defineFragOp({
  id: "simplex-noise",
  initParams() {
    return { strength: 1, size: 0.1, version: 0 };
  },
  fragBody: `
    #include <lygia/generative/snoise.glsl>
    #include <lygia/space/ratio.glsl>

    vec2 uvr = ratio(uv, resolution);
    float noise = snoise(vec3(uvr.x / size, uvr.y / size, version)) * 0.5 + 0.5;
    gl_FragColor = vec4(vec3(noise * strength), 1.0);
  `,
  Render(props) {
    return (
      <>
        <Sentence>
          Make <b>simplex noise</b> with strength{" "}
          <SentenceParamNumber
            value={props.params.strength}
            valueUP={props.paramsUP.strength}
            min={0}
            max={2}
            step={0.001}
          />{" "}
          , size{" "}
          <SentenceParamNumber
            value={props.params.size}
            valueUP={props.paramsUP.size}
            min={0.01}
            max={0.1}
            step={0.001}
          />{" "}
          , version{" "}
          <SentenceParamNumber
            value={props.params.version}
            valueUP={props.paramsUP.version}
            min={0}
            max={10}
            step={0.01}
          />
        </Sentence>
        <props.OutputHandle outputKey="out">
          <SizeCircle size={props.params.size} sizeUP={props.paramsUP.size} />
        </props.OutputHandle>
      </>
    );
  },
});

const SizeCircle = ({
  size,
  sizeUP,
}: {
  size: number;
  sizeUP: UpdateProxy<number>;
}) => {
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDims({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="h-full">
      <DraggableRenderer
        width={dims.width}
        height={dims.height}
        state={{ size }}
        onDragState={({ size }) => sizeUP.$set(size)}
        draggable={({ state, d }) => {
          const cx = dims.width / 2;
          const cy = dims.height / 2;
          const unitR = Math.min(dims.width, dims.height) / 2;
          return (
            <g
              transform={translate(cx, cy) + scale(state.size)}
              dragology={() =>
                d.vary(state, [["size"]]).during((s) => ({
                  size: Math.round(s.size * 1000) / 1000,
                }))
              }
            >
              <circle r={unitR} fill="none" pointerEvents="all" />
              <circle r={unitR} fill="none" stroke="white" strokeWidth={2} />
            </g>
          );
        }}
      />
    </div>
  );
};
