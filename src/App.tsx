import { use100vh } from "react-div-100vh";
import { Flow, initialFlow } from "./lib.js";
import { useLocalStorage } from "./useLocalStorage.js";

export const App = () => {
  const [flow, setFlow] = useLocalStorage<Flow>("flow", () => initialFlow);
  const height = use100vh();

  if (!height) {
    return null;
  }

  return (
    // for testing layout & omnicanvas & such, you can put some padding here
    <div className="bg-red-500 w-full h-full" style={{ height }}>
      <Flow flow={flow} setFlow={setFlow} />
    </div>
  );
};
