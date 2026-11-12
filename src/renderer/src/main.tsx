import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { refreshWorkspace } from "./lib/workspace";
import { router } from "./router";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

document.documentElement.dataset.platform = window.hyan.platform;

// Load persisted state before the first paint so screens never render an empty flash.
await refreshWorkspace();

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
