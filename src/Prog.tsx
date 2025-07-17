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
import { assert } from "./assert.js";
import { CodeMirrorControlled } from "./CodeMirrorControlled.js";
import {
  parseToProgramRunner,
  ProgramRunner,
  ProgramState,
  runProgramRunner,
} from "./commands.js"; // updated path
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

const initialCode = `copy`;

/* ------------------------------------------------------------------
 * Helper: create/update a WebGL texture from HTMLVideoFrame
 * ---------------------------------------------------------------- */
function ensureVideoTexture(
  gl: WebGLRenderingContext,
  texRef: React.MutableRefObject<{
    tex: WebGLTexture;
    width: number;
    height: number;
  } | null>,
  sream: WebcamStream,
) {
  if (!texRef.current) {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      sream.width,
      sream.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    texRef.current = { tex, width: sream.width, height: sream.height };
  }

  const { tex } = texRef.current!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    sream.video,
  );
  texRef.current!.width = sream.width;
  texRef.current!.height = sream.height;
}

/* ------------------------------------------------------------------
 * Main exported component
 * ---------------------------------------------------------------- */
export const Prog = () => (
  <div className="min-w-full min-h-full p-10 prose box-border">
    <OmniCanvasHost>
      <ProgInner />
    </OmniCanvasHost>
  </div>
);

const ProgInner = () => {
  const ctx = useContext(OmniCanvasContext);
  const { gl, draw } = ctx;

  const [code, setCode] = useState<string>(initialCode);
  const [finalState, setFinalState] = useState<ProgramState | null>(null);

  const webcam = useWebcam({
    enabled: true,
    width: 1920,
    preference: "FaceTime",
    vidOverrideExt: "/train-cut.webm",
  });
  const [isMirrored, setIsMirrored] = useState<boolean>(true);

  // persist runner across renders unless code changes
  const programRunnerRef = useRef<ProgramRunner | undefined>(undefined);
  const { programRunner, error } = useMemo(
    () => parseToProgramRunner(code, programRunnerRef.current, ctx),
    [code, ctx],
  );
  programRunnerRef.current = programRunner;

  /* ------------- webcam video → WebGL texture ------------------- */
  const webcamTexRef = useRef<{
    tex: WebGLTexture;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const stream = webcam.stream;

    if (!gl || !stream) return;

    const cancel = onWebcamFrame(stream, () => {
      assert(!!gl);
      ensureVideoTexture(gl, webcamTexRef, stream);

      // feed runner
      const final = runProgramRunner(programRunner, {
        type: "texture",
        texture: webcamTexRef.current!.tex,
        width: webcamTexRef.current!.width,
        height: webcamTexRef.current!.height,
      });
      setFinalState(final);
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
    <div className="flex flex-row items-start">
      <div className="flex flex-col justify-center text-gray-300">
        <CodeMirrorControlled
          value={code}
          setValue={setCode}
          extensions={extensions}
        />
        {error && <div className="text-red-500">Error: {String(error)}</div>}
        <div className="grid grid-cols-[100px_400px]">
          {webcamTexRef.current && (
            <>
              <div className="text-right pr-2 text-gray-400">input</div>
              <div
                style={{ ...(isMirrored ? { transform: "scaleX(-1)" } : {}) }}
              >
                <Monitor
                  texture={webcamTexRef.current.tex}
                  width={webcamTexRef.current.width}
                  height={webcamTexRef.current.height}
                />
              </div>
            </>
          )}
          {programRunner.map((cr) => {
            const isSel = cr.lineNum === selectedLineNum;
            const cName = isSel ? "bg-gray-600" : "";
            const res = finalState?.intermediate[cr.id];
            return (
              <Fragment key={cr.id}>
                <div className={`text-right pr-2 text-gray-400 ${cName}`}>
                  {cr.originalLine}
                  <br />
                  line {cr.lineNum}
                </div>
                <div className={cName}>
                  <ResultView result={res} mirrored={isMirrored} />
                </div>
              </Fragment>
            );
          })}
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
      {selectedTex && (
        <div
          style={{
            ...(isMirrored ? { transform: "scaleX(-1)" } : {}),
            zoom: 0.5,
          }}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------
 * Result & Monitor helpers
 * ---------------------------------------------------------------- */
function ResultView({
  result,
  mirrored,
}: {
  result: ProgramState["intermediate"][string] | undefined;
  mirrored: boolean;
}) {
  if (!result) return <div>no result</div>;
  if (result.type === "texture") {
    return (
      <Monitor
        texture={result.texture}
        width={result.width}
        height={result.height}
        mirrored={mirrored}
      />
    );
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

function Monitor({
  texture,
  width,
  height,
  mirrored = false,
}: {
  texture: WebGLTexture;
  width: number;
  height: number;
  mirrored?: boolean;
}) {
  const { draw } = useContext(OmniCanvasContext);

  const command = useCallback(() => {
    draw({ texture: texture });
  }, [draw, texture]);

  return (
    <OmniCanvasGuest
      command={command}
      className="w-full"
      style={{
        aspectRatio: width / height,
        ...(mirrored ? { transform: "scaleX(-1)" } : {}),
      }}
    />
  );
}
