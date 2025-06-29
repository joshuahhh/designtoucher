import { basicSetup } from "codemirror";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CodeMirrorControlled } from "./CodeMirrorControlled.js";
import {
  CommandResult,
  parseToProgramRunner,
  ProgramRunner,
  ProgramState,
  runProgramRunner,
} from "./commands.js";
import DomNode from "./DomNode.js";
import { numericSlider } from "./numericSlider.js";
import { onVideoFrame } from "./util.js";
import { useWebcam, WebcamSelect } from "./webcam.js";

export const Prog = () => {
  const [code, setCode] = useState<string>("delay 40\n");
  const [finalState, setFinalState] = useState<ProgramState | null>(null);

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
  const isMirrored = !shouldUseTestVideo;

  // for now, persistence of the runner is very weak; any code change
  // re-constructs the runner
  const programRunnerRef = useRef<ProgramRunner | undefined>(undefined);
  const { programRunner, error } = useMemo(
    () => parseToProgramRunner(code, programRunnerRef.current),
    [code],
  );
  programRunnerRef.current = programRunner;

  useEffect(() => {
    if (!video) {
      return;
    }

    const cancel = onVideoFrame(video, () => {
      if (video.readyState < 2) {
        console.log("Video not ready yet, skipping frame");
        return;
      }

      const finalState = runProgramRunner(programRunner, {
        type: "image",
        source: video,
      });

      setFinalState(finalState);

      // console.log("Results:", finalState);
    });
    return () => {
      console.log("Stopping video frame processing");
      cancel();
    };
  }, [programRunner, video]);

  const extensions = useMemo(() => [basicSetup, numericSlider()], []);

  const lineClassName = "text-right pr-2 text-gray-400 w-[100px]";

  return (
    <div className="flex flex-col justify-center text-gray-300">
      {/* <div className="bg-gray-400"> */}
      <CodeMirrorControlled
        value={code}
        setValue={setCode}
        extensions={extensions}
      />
      {/* </div> */}
      {error ? (
        <div className="text-red-500">
          Error parsing code:{" "}
          {error instanceof Error ? error.message : String(error)}
        </div>
      ) : undefined}
      {/* <CodeMirror initialDoc="hello there" extensions={codeMirrorSetup} /> */}
      <div className="grid grid-cols-[max-content_1fr]">
        {video && (
          <>
            <div className={lineClassName}>input</div>
            <div>
              <ResultView
                result={{ type: "image", source: video }}
                isMirrored={isMirrored}
              />
            </div>
          </>
        )}
        {programRunner.map((commandRunner) => (
          <Fragment key={commandRunner.id}>
            <div className={lineClassName}>{commandRunner.originalLine}</div>
            <div>
              <ResultView
                result={finalState?.intermediate[commandRunner.id]}
                isMirrored={isMirrored}
              />
            </div>
          </Fragment>
        ))}
      </div>
      <WebcamSelect webcam={webcam} className="mt-4" />
      {/* <FpsView right={60} top={80} /> */}
    </div>
  );
};

function ResultView({
  result,
  isMirrored,
}: {
  result: CommandResult | undefined;
  isMirrored: boolean;
}) {
  if (!result) {
    return <div>result missing</div>;
  } else if (result.type === "image") {
    return (
      <>
        <DomNode
          node={result.source}
          {...(isMirrored && { style: { transform: "scaleX(-1)" } })}
          apply={(node) => (node.style.width = "100%")}
        />
      </>
    );
  } else if (result.type === "error") {
    return <div style={{ color: "red" }}>{result.message}</div>;
  } else {
    return <div>not implemented</div>;
  }
}
