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
import { onVideoFrame } from "./util.js";
import { useWebcam, WebcamSelect } from "./webcam.js";

export const Prog = () => {
  const [code, setCode] = useState<string>("delay 40\n");
  const [finalState, setFinalState] = useState<ProgramState | null>(null);

  const shouldUseTestVideo = false;
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

  // const [programRunner, setProgramRunner] = useState<ProgramRunner | null>(
  //   null,
  // );
  // const programRunnerRef = useRefForCallback(programRunner);
  // const [error, setError] = useState<unknown>(null);
  // useEffect(() => {
  //   const { programRunner, error } = parseToProgramRunner(
  //     code,
  //     programRunnerRef.current ?? undefined,
  //   );
  //   setProgramRunner(programRunner);
  //   setError(error);
  // }, [code, programRunnerRef]);

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

  return (
    <div className="flex flex-col justify-center text-gray-300">
      {/* <div className="bg-gray-400"> */}
      <CodeMirrorControlled
        value={code}
        setValue={setCode}
        extensions={basicSetup}
      />
      {/* </div> */}
      {error ? (
        <div className="text-red-500">
          Error parsing code:{" "}
          {error instanceof Error ? error.message : String(error)}
        </div>
      ) : undefined}
      {/* <CodeMirror initialDoc="hello there" extensions={codeMirrorSetup} /> */}
      <div className="grid grid-cols-2">
        {video && (
          <>
            <div>input</div>
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
            <div>{commandRunner.originalLine}</div>
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
  // if (result.type === "contours") {
  //   return (
  //     <>
  //       {originalImage && dims(originalImage)[0] > 0 && (
  //         <DomNode
  //           node={(() => {
  //             const canvas = document.createElement("canvas");
  //             canvas.classList.toggle("mirrored", isMirrored);
  //             [canvas.width, canvas.height] = dims(originalImage);
  //             const ctx = canvas.getContext("2d")!;
  //             ctx.drawImage(originalImage, 0, 0);
  //             let dst = cv.imread(canvas);
  //             for (
  //               let i = 0;
  //               i < (result.contours.size() as any as number);
  //               i++
  //             ) {
  //               let color = new cv.Scalar(0, 255, 0, 255);
  //               cv.drawContours(
  //                 dst,
  //                 result.contours,
  //                 i,
  //                 color,
  //                 3,
  //                 cv.LINE_8,
  //                 result.hierarchy,
  //                 100,
  //               );
  //             }
  //             cv.imshow(canvas, dst);
  //             dst.delete();
  //             return canvas;
  //           })()}
  //         />
  //       )}
  //       <div className="output-desc">{result.contours.size()} contour(s)</div>
  //     </>
  //   );
  // }
  // if (result.type === "contour") {
  //   return (
  //     <>
  //       {originalImage && dims(originalImage)[0] > 0 && (
  //         <DomNode
  //           node={(() => {
  //             const canvas = document.createElement("canvas");
  //             canvas.classList.toggle("mirrored", isMirrored);
  //             [canvas.width, canvas.height] = dims(originalImage);
  //             const ctx = canvas.getContext("2d")!;
  //             ctx.drawImage(originalImage, 0, 0);
  //             let dst = cv.imread(canvas);
  //             let color = new cv.Scalar(0, 255, 0, 255);
  //             let matVec = new cv.MatVector();
  //             matVec.push_back(result.contour);
  //             cv.drawContours(dst, matVec, 0, color, 3, cv.LINE_8);
  //             cv.imshow(canvas, dst);
  //             dst.delete();
  //             matVec.delete();
  //             return canvas;
  //           })()}
  //         />
  //       )}
  //       <div className="output-desc">a contour</div>
  //     </>
  //   );
  // }
  // if (result.type === "point") {
  //   return (
  //     <>
  //       {originalImage && dims(originalImage)[0] > 0 && (
  //         <DomNode
  //           node={(() => {
  //             const canvas = document.createElement("canvas");
  //             canvas.classList.toggle("mirrored", isMirrored);
  //             [canvas.width, canvas.height] = dims(originalImage);
  //             const ctx = canvas.getContext("2d")!;
  //             ctx.drawImage(originalImage, 0, 0);
  //             ctx.beginPath();
  //             ctx.arc(
  //               result.point.x,
  //               result.point.y,
  //               10,
  //               0 * Math.PI,
  //               2 * Math.PI,
  //             );
  //             ctx.fillStyle = "rgb(0, 255, 0)";
  //             ctx.fill();
  //             ctx.strokeStyle = "rgb(0, 0, 0)";
  //             ctx.stroke();
  //             return canvas;
  //           })()}
  //         />
  //       )}
  //       <div className="output-desc">
  //         a point: (
  //         {(() => {
  //           let x = result.point.x;
  //           if (isMirrored && originalImage) {
  //             x = dims(originalImage)[0] - x;
  //           }
  //           return x.toFixed(3);
  //         })()}
  //         , {result.point.y.toFixed(3)})
  //       </div>
  //     </>
  //   );
  // }
  // if (result.type === "raw") {
  //   return <pre>{JSON.stringify(result.data, undefined, 2)}</pre>;
  // } else if (result.type === "error") {
  //   return <div style={{ color: "red" }}>{result.message}</div>;
  // }
}

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
