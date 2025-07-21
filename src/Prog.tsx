import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup, EditorView } from "codemirror";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { assert } from "./assert.js";
import { CodeMirrorControlled } from "./CodeMirrorControlled.js";
import {
  CommandRunner,
  parseToProgramRunner,
  ProgramRunner,
  ProgramState,
  runProgramRunner,
} from "./commands.js"; // updated path
import { newTex, Tex } from "./mygl.js";
import {
  OmniCanvasContext,
  OmniCanvasGuest,
  OmniCanvasHost,
} from "./OmniCanvas.js";
import {
  onWebcamFrame,
  useWebcam,
  WebcamSelect,
  WebcamStream,
} from "./webcam.js";

// const initialCode = `gray`;
const initialCode = `copy\ndelay 20\n-\n* 10`;

const movies = [
  "/Nature/Movie.1.mp4",
  "/Nature/Movie.2.mp4",
  "/Nature/Movie.3.mp4",
  "/Nature/Movie.4.mp4",
  "/Nature/Movie.5.mp4",
];

/* ------------------------------------------------------------------
 * Helper: create/update a WebGL texture from HTMLVideoFrame
 * ---------------------------------------------------------------- */
function ensureVideoTexture(
  gl: WebGLRenderingContext,
  texRef: React.MutableRefObject<Tex | null>,
  stream: WebcamStream,
) {
  if (!texRef.current) {
    const tex = newTex(gl, stream.width, stream.height);
    texRef.current = tex;
  }

  const tex = texRef.current!;
  gl.bindTexture(gl.TEXTURE_2D, tex.texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    stream.video,
  );
  tex.width = stream.width;
  tex.height = stream.height;
}

/* ------------------------------------------------------------------
 * Main exported component
 * ---------------------------------------------------------------- */
export const Prog = () => (
  <div className="flex w-full h-full overflow-hidden box-border">
    <OmniCanvasHost>
      <ProgInner />
    </OmniCanvasHost>
  </div>
);

const ProgInner = () => {
  const ctx = useContext(OmniCanvasContext);
  const { gl } = ctx;

  const [code, setCode] = useState<string>(initialCode);
  const [finalState, setFinalState] = useState<ProgramState | null>(null);

  const [videoSource, setVideoSource] = useState<string>(movies[0]);

  const webcam = useWebcam({
    enabled: true,
    width: 1920,
    preference: "FaceTime",
    // vidOverrideExt: "/train-cut.webm",
    vidOverrideExt: movies.includes(videoSource) ? videoSource : undefined,
  });
  useEffect(() => {
    // This effect runs whenever the video source changes

    // HACK: some trouble transitioning to new video source?
    programRunnerRef.current = undefined;
    webcamTexRef.current = null;

    if (!movies.includes(videoSource)) {
      webcam.setDeviceId(videoSource);
    }
  }, [videoSource, webcam]);

  const [isMirrored, setIsMirrored] = useState<boolean>(true);

  // persist runner across renders unless code changes
  const programRunnerRef = useRef<ProgramRunner | undefined>(undefined);
  const { programRunner, error } = useMemo(
    () => parseToProgramRunner(code, programRunnerRef.current, ctx),
    [code, ctx],
  );
  programRunnerRef.current = programRunner;

  /* ------------- webcam video → WebGL texture ------------------- */
  const webcamTexRef = useRef<Tex | null>(null);

  useEffect(() => {
    const stream = webcam.stream;

    if (!gl || !stream) return;

    const cancel = onWebcamFrame(stream, () => {
      // console.log("webcam frame");
      assert(!!gl);
      ensureVideoTexture(gl, webcamTexRef, stream);
      // debugTex(gl, webcamTexRef.current!);

      // feed runner
      const final = runProgramRunner(programRunner, {
        type: "texture",
        tex: webcamTexRef.current!,
      });
      setFinalState(final);

      // if (webcamTexRef.current) {
      //   const firstResult = final.intermediate[programRunner[0].id];
      //   assert(firstResult.type === "texture");
      //   debugTex(gl, firstResult.tex);
      // }
    });
    return cancel;
  }, [gl, webcam.stream, programRunner]);

  /* ------------- CodeMirror config ------------------------------ */
  const [selectedLineNum, setSelectedLineNum] = useState<number>(1);
  const extensions = useMemo(() => {
    const selectionWatcher = EditorView.updateListener.of((update) => {
      if (update.selectionSet) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos).number;
        setSelectedLineNum(line);
      }
    });
    return [basicSetup, oneDark, selectionWatcher];
  }, []);

  /* ------------- Selected texture for preview ------------------- */
  const selectedRunner = programRunner.find(
    (r) => r.lineNum === selectedLineNum,
  );
  const selectedRes =
    selectedRunner && finalState?.intermediate[selectedRunner.id];
  const selectedTex =
    selectedRes && selectedRes.type === "texture" ? selectedRes : undefined;

  return (
    <div className="flex flex-row items-start w-full h-full overflow-hidden">
      {/* {webcamTexRef.current && (
        <div className="w-[250px]">
          <Monitor gl={gl} tex={webcamTexRef.current} />
        </div>
      )} */}
      <div className="flex overflow-y-auto max-h-full">
        <div className="flex flex-col justify-center text-gray-300">
          <div className="sticky top-0">
            <select
              value={videoSource}
              onChange={(e) => {
                setVideoSource(e.target.value);
              }}
            >
              {webcam.devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Unnamed camera"}
                </option>
              ))}
              {movies.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <CodeMirrorControlled
              value={code}
              setValue={setCode}
              extensions={extensions}
            />
          </div>
          {error ? (
            <div className="text-red-500">Error: {String(error)}</div>
          ) : null}
          <div className="grid grid-cols-[100px_400px] pt-10">
            {webcamTexRef.current && (
              <>
                <div className="text-right pr-2 text-gray-400">input</div>
                <Monitor gl={gl} tex={webcamTexRef.current} />
              </>
            )}
            {programRunner.map((cr) => (
              <LineOutput
                key={cr.id}
                cr={cr}
                selectedLineNum={selectedLineNum}
                finalState={finalState!}
                gl={gl}
                isMirrored={isMirrored}
              />
            ))}
          </div>
          <WebcamSelect webcam={webcam} className="mt-4" />
          <div className="flex items-center mt-2">
            <label className="mr-2">Mirror:</label>
            <input
              type="checkbox"
              checked={isMirrored}
              onChange={(e) => setIsMirrored(e.target.checked)}
            />
          </div>
        </div>
      </div>
      {selectedTex && (
        <div className="flex-1 ml-4">
          <Monitor gl={gl} tex={selectedTex.tex} />
        </div>
      )}
    </div>
  );
};

function LineOutput({
  cr,
  selectedLineNum,
  finalState,
  gl,
  isMirrored,
}: {
  cr: CommandRunner;
  selectedLineNum: number;
  finalState: ProgramState;
  gl: WebGLRenderingContext;
  isMirrored: boolean;
}) {
  const isSel = cr.lineNum === selectedLineNum;
  const cName = isSel ? "bg-gray-600" : "";
  const res = finalState?.intermediate[cr.id];

  const [div, setDiv] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isSel) {
      div?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [div, isSel]);

  return (
    <>
      <div className={`text-right pr-2 text-gray-400 ${cName}`}>
        {cr.originalLine}
        <br />
        line {cr.lineNum}
      </div>
      <div ref={setDiv} className={cName}>
        <ResultView gl={gl} result={res} mirrored={isMirrored} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------
 * Result & Monitor helpers
 * ---------------------------------------------------------------- */
function ResultView({
  gl,
  result,
}: {
  gl: WebGLRenderingContext;
  result: ProgramState["intermediate"][string] | undefined;
  mirrored: boolean;
}) {
  if (!result) return <div>no result</div>;
  if (result.type === "texture") {
    return <Monitor gl={gl} tex={result.tex} />;
  }
  if (result.type === "error") {
    return (
      <div className="text-red-500">
        {result.error.message}
        <button onClick={() => console.error(result.error)}>Log</button>
      </div>
    );
  }
  return <div>not implemented</div>;
}

function Monitor({ gl, tex }: { gl: WebGLRenderingContext; tex: Tex }) {
  const { draw } = useContext(OmniCanvasContext);

  const command = useCallback(
    (viewport: [number, number, number, number]) => {
      draw({ texture: tex.texture, viewport });
    },
    [draw, tex.texture],
  );

  // const pixels = usePixels(gl, tex);
  // const sum = useMemo(() => {
  //   if (!pixels) return 0;
  //   return pixels.reduce((acc, val) => acc + val, 0);
  // }, [pixels]);

  return (
    <div>
      <OmniCanvasGuest
        command={command}
        className="w-full"
        style={{ aspectRatio: tex.width / tex.height }}
      />
      {/* <div>{new Date().toISOString()}</div>
      <div>{sum}</div> */}
    </div>
  );
}
