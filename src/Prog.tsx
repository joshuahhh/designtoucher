import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup, EditorView } from "codemirror";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CodeMirrorControlled } from "./CodeMirrorControlled.js";
import {
  CommandResult,
  GlfxResources,
  parseToProgramRunner,
  ProgramRunner,
  ProgramState,
  runProgramRunner,
  updateGlfxResources,
} from "./commands.js";
import DomNode from "./DomNode.js";
import { useRefForCallback } from "./useRefForCallback.js";
import { animate, onVideoFrame } from "./util.js";
import { useWebcam, WebcamSelect } from "./webcam.js";

// const initialCode = `-> cam\nbc 1 1\n<- cam`;
// "delay 40\n-\n"
// const initialCode = `bc 0 0\n* 1\nbc 0 0`;
const initialCode = `bc 0 0\ndelay 10\n-`;

export const Prog = () => {
  const [code, setCode] = useState<string>(initialCode);
  const [finalState, setFinalState] = useState<ProgramState | null>(null);

  const shouldUseTestVideo = false;
  const webcam = useWebcam({
    enabled: !shouldUseTestVideo,
    // preference: "Iriun",
    width: 1920,
    preference: "FaceTime",
  });
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
  const [isMirrored, setIsMirrored] = useState<boolean>(!shouldUseTestVideo);

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

      // console.log(programRunner);
      // console.log("Results:", finalState);
    });
    return () => {
      console.log("Stopping video frame processing");
      cancel();
    };
  }, [programRunner, video]);

  const [selectedLineNum, setSelectedLineNum] = useState<number>(1);

  const extensions = useMemo(() => {
    const selectionWatcher = EditorView.updateListener.of((update) => {
      if (update.selectionSet) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos).number;
        setSelectedLineNum(line);
      }
    });
    return [
      basicSetup,
      // numericSlider()
      oneDark,
      selectionWatcher,
    ];
  }, []);

  const lineClassName = "text-right pr-2 text-gray-400 w-[100px]";

  const selectedProgramRunner = programRunner.find(
    (programRunner) => programRunner.lineNum === selectedLineNum,
  );
  const selectedResult =
    selectedProgramRunner && finalState?.intermediate[selectedProgramRunner.id];
  const selectedCanvas =
    selectedResult?.type === "image" ? selectedResult.source : undefined;

  return (
    <div className="flex flex-row items-start">
      <div className="flex flex-col justify-center text-gray-300 max-w-80">
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
          {programRunner.map((commandRunner) => {
            const isSelected = commandRunner.lineNum === selectedLineNum;
            const className = isSelected ? "bg-gray-600" : "";

            return (
              <Fragment key={commandRunner.id}>
                <div className={lineClassName + " " + className}>
                  {commandRunner.originalLine}
                  <br />
                  lineNum: {commandRunner.lineNum}
                </div>
                <div className={className}>
                  <ResultView
                    result={finalState?.intermediate[commandRunner.id]}
                    isMirrored={isMirrored}
                  />
                </div>
              </Fragment>
            );
          })}
        </div>
        <WebcamSelect webcam={webcam} className="mt-4" />
        {/* <FpsView right={60} top={80} /> */}
        {/* {JSON.stringify(selectedLineNum, null, 2) || "no selection"} */}
        <div className="flex items-center mt-2">
          <label className="mr-2">Mirror:</label>
          <input
            type="checkbox"
            checked={isMirrored}
            onChange={(e) => setIsMirrored(e.target.checked)}
          />
        </div>
      </div>
      {selectedProgramRunner && (
        <DomNode
          node={selectedCanvas}
          style={isMirrored ? { transform: "scaleX(-1)" } : {}}
        />
      )}
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
    // return (
    //   <>
    //     <DomNode
    //       node={result.source}
    //       {...(isMirrored && { style: { transform: "scaleX(-1)" } })}
    //       apply={(node) => (node.style.width = "100%")}
    //     />
    //   </>
    // );
    return <Monitor source={result.source} />;
    // return null;
  } else if (result.type === "error") {
    return <div style={{ color: "red" }}>{result.message}</div>;
  } else {
    return <div>not implemented</div>;
  }
}

function Monitor({ source }: { source: HTMLCanvasElement | HTMLVideoElement }) {
  // const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  // const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const glfxResourcesRef = useRef<GlfxResources | undefined>(undefined);

  // useEffect(() => {
  //   if (!canvasRef.current) return;

  //   const observer = new ResizeObserver((entries) => {
  //     for (let entry of entries) {
  //       if (entry.target === canvasRef.current) {
  //         const rect = entry.contentRect;
  //         setDimensions({
  //           width: rect.width,
  //           height: rect.height,
  //         });
  //       }
  //     }
  //   });

  //   observer.observe(canvasRef.current);

  //   return () => {
  //     observer.disconnect();
  //   };
  // }, []);

  const sourceRef = useRefForCallback(source);

  useEffect(() => {
    return animate(() => {
      const source = sourceRef.current;
      const glfxResources = (glfxResourcesRef.current = updateGlfxResources(
        glfxResourcesRef.current,
        source,
      ));
      glfxResources.canvas.draw(glfxResources.texture);
      glfxResources.canvas.update();
    });
  });

  // return (
  //   <canvas
  //     ref={canvasRef}
  //     width={dimensions.width}
  //     height={dimensions.height}
  //     style={{ width: "100%", display: "block" }}
  //   />
  // );

  return (
    glfxResourcesRef.current && (
      <DomNode
        node={glfxResourcesRef.current.canvas}
        apply={(node) => (node.style.width = "100%")}
      />
    )
  );
}
