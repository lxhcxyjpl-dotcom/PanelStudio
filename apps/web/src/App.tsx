import { SCHEMA_VERSION } from "@panelstudio/contracts/version";
import { uiFontFamily } from "@panelstudio/ui";
import "@panelstudio/ui/tokens.css";

export function App() {
  return (
    <main className="shell" style={{ fontFamily: uiFontFamily }}>
      <p className="eyebrow">Phase 0</p>
      <h1>PanelStudio</h1>
      <p>
        Shared document schema version {SCHEMA_VERSION}. This shell loads the theme tokens.
        Import, layout, and export are not part of this phase.
      </p>
    </main>
  );
}
