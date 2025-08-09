import { Flow, initialFlow } from "./lib.js";
import { useLocalStorage } from "./useLocalStorage.js";

export const App = () => {
  const [flow, setFlow] = useLocalStorage<Flow>("flow", () => initialFlow);
  return (
    // for testing layout & omnicanvas & such, you can put some padding here
    <div className="bg-red-500 w-full h-full">
      <Flow flow={flow} setFlow={setFlow} />
    </div>
  );
};
