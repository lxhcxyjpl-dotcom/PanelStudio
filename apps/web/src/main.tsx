import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { uiFontFamily } from "@panelstudio/ui";
import "@panelstudio/ui/tokens.css";
import "./i18n";
import "./styles.css";
import { queryClient } from "./state/query";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
document.body.style.fontFamily = uiFontFamily;

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
