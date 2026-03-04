import clsx from "clsx";
import { use100vh } from "react-div-100vh";
import { Flow, initialFlow } from "./lib.js";
import { useIDB } from "./useIDB.js";

export const App = () => {
  const [flow, setFlow] = useIDB<Flow>("flow", () => initialFlow);
  const height = use100vh();

  if (!height) {
    return null;
  }

  return (
    // for testing layout & omnicanvas & such, you can put some padding here
    <div
      className={clsx("w-full h-full", { "p-20 bg-red-500": false })}
      style={{ height }}
    >
      <Flow flow={flow} setFlow={setFlow} />
    </div>
  );
};
