import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup, EditorView } from "codemirror";
import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Texture2D } from "regl";
import { CodeMirrorControlled } from "./CodeMirrorControlled.js";
import {
  CommandResult,
  parseToProgramRunner,
  ProgramRunner,
  ProgramState,
  runProgramRunner,
} from "./commands.js";
import {
  OmniCanvasContext,
  OmniCanvasGuest,
  OmniCanvasHost,
} from "./OmniCanvas.js";
import { onWebcamFrame, useWebcam, WebcamSelect } from "./webcam.js";

// const initialCode = `-> cam\nbc 1 1\n<- cam`;
// "delay 40\n-\n"
// const initialCode = `bc 0 0\n* 1\nbc 0 0`;
const initialCode = `copy`;
// const initialCode = ``;
// const initialCode = `bc 0 0\ndelay 10\n-`;
// const initialCode = `bc 0 0`;

export const Prog = () => {
  return (
    <div className="min-w-full min-h-full p-10 prose box-border">
      <OmniCanvasHost>
        <ProgInner />
      </OmniCanvasHost>
    </div>
  );
};

const ProgInner = () => {
  const ctx = useContext(OmniCanvasContext);
  const { regl } = ctx;

  const [code, setCode] = useState<string>(initialCode);
  const [finalState, setFinalState] = useState<ProgramState | null>(null);

  const shouldUseTestVideo = false;
  const webcam = useWebcam({
    enabled: !shouldUseTestVideo,
    // preference: "Iriun",
    width: 1920,
    preference: "FaceTime",
    // vidOverrideExt: "/IMG_0110.MOV",
    // vidOverrideExt: "/IMG-0110-stable.mp4",
    // vidOverrideExt: "/IMG_0110.stable.MOV",
    vidOverrideExt: "/train-cut.webm",
  });
  const [isMirrored, setIsMirrored] = useState<boolean>(!shouldUseTestVideo);

  // for now, persistence of the runner is very weak; any code change
  // re-constructs the runner
  const programRunnerRef = useRef<ProgramRunner | undefined>(undefined);
  const { programRunner, error } = useMemo(
    () => parseToProgramRunner(code, programRunnerRef.current, ctx),
    [code, ctx],
  );
  programRunnerRef.current = programRunner;

  const webcamTextureRef = useRef<Texture2D | null>(null);

  useEffect(() => {
    const stream = webcam.stream;

    if (!stream) {
      return;
    }

    const cancel = onWebcamFrame(stream, () => {
      regl.poll();

      // update texture
      if (!webcamTextureRef.current) {
        console.log("initing webcam texture", stream.width, stream.height);
        webcamTextureRef.current = regl.texture({
          width: stream.width,
          height: stream.height,
          type: "uint8",
          data: stream.video,
          flipY: true,
        });
        console.log(
          "inited",
          webcamTextureRef.current.width,
          webcamTextureRef.current.height,
        );
      } else {
        // console.log("updating webcam texture");
        webcamTextureRef.current.subimage({
          data: stream.video,
          flipY: true,
        });
      }

      // run program
      const finalState = runProgramRunner(programRunner, {
        type: "texture",
        texture: webcamTextureRef.current,
      });

      setFinalState(finalState);

      // console.log(programRunner);
      // console.log("Results:", finalState);
    });
    return () => {
      console.log(
        "Stopping video frame processing; we expect a onVideoFrame cancellation",
      );
      cancel();
    };
  }, [programRunner, regl, webcam.stream]);

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
  const selectedTexture =
    selectedResult?.type === "texture" ? selectedResult.texture : undefined;

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
          {webcam.stream && (
            <>
              <div className={lineClassName}>input</div>
              <div
                style={{
                  ...(isMirrored ? { transform: "scaleX(-1)" } : {}),
                  width: "100%",
                  height: "auto",
                }}
              >
                {webcamTextureRef.current && (
                  <Monitor texture={webcamTextureRef.current} />
                )}
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
      {selectedTexture && (
        <div
          style={{
            ...(isMirrored ? { transform: "scaleX(-1)" } : {}),
            zoom: 0.5,
          }}
        >
          {/* <Monitor texture={selectedTexture} /> */}
        </div>
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
  } else if (result.type === "texture") {
    // return (
    //   <>
    //     <DomNode
    //       node={result.source}
    //       {...(isMirrored && { style: { transform: "scaleX(-1)" } })}
    //       apply={(node) => (node.style.width = "100%")}
    //     />
    //   </>
    // );
    return <Monitor texture={result.texture} />;
  } else if (result.type === "error") {
    return (
      <div style={{ color: "red" }}>
        {result.error.message}{" "}
        <button
          onClick={() => {
            console.log(result.error);
          }}
        >
          Log
        </button>
      </div>
    );
  } else {
    return <div>not implemented</div>;
  }
}

function Monitor({ texture }: { texture: Texture2D }) {
  const { copy, draw } = useContext(OmniCanvasContext);

  const command = useCallback(() => {
    // console.log(
    //   "gonna draw",
    //   texture.width,
    //   texture.height,
    //   texture.format,
    //   texture.type,
    // );
    draw({
      tex1: texture,
    });
  }, [draw, texture]);

  return (
    <OmniCanvasGuest
      command={command}
      className="w-full"
      style={{ aspectRatio: texture.width / texture.height }}
    />
  );
}
