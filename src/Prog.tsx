import { history } from "@codemirror/commands";
import { basicSetup } from "codemirror";
import { useEffect, useMemo, useRef, useState } from "react";
import { assert } from "./assert.js";
import { CodeMirrorControlled } from "./CodeMirrorControlled.js";
import DomNode from "./DomNode.js";
import FilterChainRunner, { RunnerResults } from "./FilterChainRunner.js";
import { FilterChain } from "./filters.js";
import { onVideoFrame } from "./util.js";
import { useWebcam, WebcamSelect } from "./webcam.js";

export const Prog = () => {
  const [code, setCode] = useState<string>("blur 10\n");
  const [results, setResults] = useState<RunnerResults | null>(null);
  const [error, setError] = useState<unknown>(null);

  const shouldUseTestVideo = true;
  const webcam = useWebcam(!shouldUseTestVideo);
  const video = useMemo(() => {
    if (shouldUseTestVideo) {
      const video = document.createElement("video");
      video.autoplay = true;
      video.src = "/train-cut.webm";
      video.volume = 0;
      video.loop = true;
      video.play();
      return video;
    } else {
      return webcam.stream?.video;
    }
  }, [shouldUseTestVideo, webcam.stream?.video]);

  const runner = useRef(new FilterChainRunner());

  useEffect(() => {
    // Whenever the code changes, we parse it to a filter chain.
    const { chain, error } = parseToFilterChain(code);
    console.log("Parsed chain:", chain);
    // HACK: We add a "Do nothing" filter at the start of the chain
    // so that the final value is never the video stream itself.
    runner.current.filterChain = [
      { id: "-1", specName: "Do nothing", parameterValues: {} },
      ...chain,
    ];
    setError(error);
  }, [code]);

  useEffect(() => {
    if (!video) {
      return;
    }

    const cancel = onVideoFrame(video, () => {
      console.log("Processing video frame");

      if (video.readyState < 2) {
        console.log("Video not ready yet, skipping frame");
        return;
      }

      const results = runner.current.run({
        type: "image",
        source: video,
      });

      setResults(results);

      console.log("Results:", results);
    });
    return () => {
      console.log("Stopping video frame processing");
      cancel();
    };
  }, [video]);

  const extensions = useMemo(() => [history()], []);

  return (
    <div className="w-screen h-screen flex flex-col justify-center bg-black">
      <div className="bg-gray-400">
        <CodeMirrorControlled
          value={code}
          setValue={setCode}
          extensions={basicSetup}
        />
      </div>
      {error ? (
        <div className="text-red-500">
          Error parsing code:{" "}
          {error instanceof Error ? error.message : String(error)}
        </div>
      ) : undefined}
      {/* <CodeMirror initialDoc="hello there" extensions={codeMirrorSetup} /> */}
      <div className="flex flex-row">
        <DomNode
          node={video}
          style={{ transform: "scaleX(-1)" }}
          apply={(node) => (node.style.width = "100%")}
        />
        {results?.final?.type === "image" && (
          <DomNode
            node={results.final.source}
            style={{ transform: "scaleX(-1)" }}
            apply={(node) => (node.style.width = "100%")}
          />
        )}
      </div>
      <WebcamSelect webcam={webcam} className="mt-4" />
      {/* <FpsView right={60} top={80} /> */}
    </div>
  );
};

export type ParseResult = { chain: FilterChain; error?: unknown };

function parseToFilterChain(code: string): ParseResult {
  let chain: FilterChain = [];
  try {
    for (const line of code.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length === 0) continue;
      const command = parts[0].toLowerCase();
      const args = parts.slice(1).map((arg) => parseFloat(arg));
      if (command === "blur") {
        assert(args.length === 1, "Blur command requires one argument");
        chain.push({
          id: chain.length.toString(),
          specName: "Blur",
          parameterValues: { Distance: args[0] },
        });
      } else if (command === "bc") {
        assert(
          args.length === 2,
          "Brightness/Contrast command requires two arguments",
        );
        chain.push({
          id: chain.length.toString(),
          specName: "Brightness & contrast",
          parameterValues: { Brightness: args[0], Contrast: args[1] },
        });
      } else if (command === "sh") {
        assert(
          args.length === 2,
          "Saturation/Hue command requires two arguments",
        );
        chain.push({
          id: chain.length.toString(),
          specName: "Saturation & hue",
          parameterValues: { Saturation: args[0], Hue: args[1] },
        });
      }
    }
    // This function would parse the code and return a FilterChain.
    // For now, we return a static chain for demonstration purposes.
    return { chain };
  } catch (e) {
    console.error("Error parsing code to filter chain:", e);
    return { chain, error: e };
  }
}

const chain: FilterChain = [
  { id: "1", specName: "Blur", parameterValues: { Distance: 10 } },
  { id: "2", specName: "Blur", parameterValues: { Distance: 10 } },
];

/*
  -> img
  brightness(0.5)
  contrast(1.2)
  glsl(tex) {
    vec3 new = texture2D(tex, uv).rgb;
    vec3 old = texture2D(tex[-1], uv).rgb;
    vec3 diff = abs(new - old);
    gl_FragColor = vec4(diff * 9.0, 1.0);
  }
  blur(5)
  <- img
  glsl()
*/
