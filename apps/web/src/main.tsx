import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { uiFontFamily } from "@panelstudio/ui";
import { initializeLabelFonts } from "@panelstudio/core/labels";
import "@panelstudio/ui/tokens.css";
import "./i18n";
import "./styles.css";
import { queryClient } from "./state/query";
import { readPrefs } from "./prefs";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
document.body.style.fontFamily = uiFontFamily;

const mount = createRoot(root);
void initializeLabelFonts().then(() => mount.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)).catch(() => {
  const english = readPrefs().locale === "en-US";
  mount.render(<p role="alert">{english ? "The bundled fonts could not be loaded." : "内置字体加载失败。"}{" "}
    <button type="button" onClick={() => location.reload()}>{english ? "Retry" : "重试"}</button></p>);
});
