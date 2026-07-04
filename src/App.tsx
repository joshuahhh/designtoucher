import clsx from "clsx";
import { useMemo } from "react";
import { use100vh } from "react-div-100vh";
import { FpsMeter } from "./FpsMeter.js";
import { Flow, initialFlow } from "./lib.js";
import { clearProjectFromURL, getProjectFromURL } from "./share.js";
import { useIDB } from "./useIDB.js";
import { usePhoneCapture } from "./usePhoneCapture.js";

export const App = () => {
  const projectOverride = useMemo(() => {
    const flow = getProjectFromURL();
    if (flow) clearProjectFromURL();
    return flow;
  }, []);

  const [flow, setFlow] = useIDB<Flow>(
    "flow",
    () => initialFlow,
    projectOverride,
  );

  const phoneCapture = usePhoneCapture(setFlow);

  const height = use100vh();

  if (!height) {
    return null;
  }

  return (
    <div
      className={clsx("w-full h-full", { "p-20 bg-red-500": false })}
      style={{ height }}
    >
      <Flow flow={flow} setFlow={setFlow} phoneCapture={phoneCapture} />

      <FpsMeter />
    </div>
  );
};
