import * as Tooltip from "@radix-ui/react-tooltip";
import { Workspace } from "./ui/Workspace";

export function App() {
  return (
    <Tooltip.Provider delayDuration={400}>
      <Workspace />
    </Tooltip.Provider>
  );
}
